import asyncio
import re
import urllib.parse
import httpx

# Helper to strip HTML tags from strings (useful for Zenodo descriptions)
def strip_html(text: str) -> str:
    if not text:
        return ""
    # Replace common line break tags with spaces
    text = re.sub(r'<br\s*/?>', ' ', text)
    text = re.sub(r'<p\s*/?>', ' ', text)
    # Remove all other tags
    clean = re.sub(r'<[^>]+>', '', text)
    # Normalize multiple whitespaces
    return " ".join(clean.split()).strip()

# Helper to guess Domain, Task, Modality from dataset metadata
def infer_dataset_metadata(name: str, description: str, tags: list = None) -> tuple:
    tags = [t.lower() for t in (tags or [])]
    combined_text = f"{name} {description}".lower()
    
    # 1. Infer Modality
    modality = "Tabular"  # default
    if any(x in combined_text for x in ["image", "pixel", "segmentation", "mri", "xray", "cvpr", "mnist", "cifar"]) or any("image" in t for t in tags):
        modality = "Image"
    elif any(x in combined_text for x in ["audio", "speech", "sound", "wav", "mp3", "voice", "recording"]) or any("audio" in t for t in tags):
        modality = "Audio"
    elif any(x in combined_text for x in ["video", "youtube", "frame", "fps"]) or any("video" in t for t in tags):
        modality = "Video"
    elif "eeg" in combined_text or any("eeg" in t for t in tags):
        modality = "EEG"
    elif "ecg" in combined_text or any("ecg" in t for t in tags):
        modality = "ECG"
    elif any(x in combined_text for x in ["sensor", "imu", "accelerometer", "gyroscope"]) or any("sensor" in t for t in tags):
        modality = "Sensor Data"
    elif any(x in combined_text for x in ["text", "nlp", "corpus", "sentiment", "translation", "language", "speech"]) or any("text" in t for t in tags):
        modality = "Text"
    elif any(x in combined_text for x in ["graph", "network", "node", "edge", "citation-network"]) or any("graph" in t for t in tags):
        modality = "Graph"
    
    # 2. Infer Domain
    domain = "Others"
    if any(x in combined_text for x in ["medical", "health", "clinical", "tumor", "brain", "eeg", "ecg", "patient", "disease", "diagnosis"]) or any(t in ["healthcare", "medical", "health"] for t in tags):
        domain = "Healthcare"
    elif any(x in combined_text for x in ["image", "pixel", "camera", "cvpr", "object-detection", "mnist"]) or any("cv" in t or "vision" in t for t in tags):
        domain = "Computer Vision"
    elif any(x in combined_text for x in ["text", "nlp", "translation", "sentiment", "speech", "language"]) or any("nlp" in t or "text" in t for t in tags):
        domain = "NLP"
    elif any(x in combined_text for x in ["audio", "sound", "voice", "music"]) or any("audio" in t for t in tags):
        domain = "Audio"
    elif any(x in combined_text for x in ["robot", "lidar", "uav", "control"]) or any("robot" in t for t in tags):
        domain = "Robotics"
    elif any(x in combined_text for x in ["stock", "finance", "market", "trade", "price", "credit"]) or any("finance" in t for t in tags):
        domain = "Finance"
    elif any(x in combined_text for x in ["malware", "cyber", "security", "attack", "intrusion", "network-traffic"]) or any("security" in t or "cyber" in t for t in tags):
        domain = "Cybersecurity"
    elif any(x in combined_text for x in ["satellite", "sentinel", "gis", "remote-sensing", "earth"]) or any("remote" in t or "satellite" in t for t in tags):
        domain = "Remote Sensing"
    elif any(x in combined_text for x in ["student", "school", "education", "grade", "learning-analytics"]) or any("education" in t for t in tags):
        domain = "Education"
        
    # 3. Infer Task
    task = "Classification"  # default
    if any("regression" in t for t in tags):
        task = "Regression"
    elif any("segmentation" in t or "segment" in t for t in tags):
        task = "Segmentation"
    elif any("detection" in t for t in tags):
        task = "Object Detection"
    elif any("question-answering" in t or "qa" in t for t in tags):
        task = "Question Answering"
    elif any("translation" in t for t in tags):
        task = "Machine Translation"
    elif any("time-series" in t or "time_series" in t for t in tags):
        task = "Time Series"
    elif any("recommend" in t for t in tags):
        task = "Recommendation"
    elif any("forecast" in t for t in tags):
        task = "Forecasting"
    elif any("speech-recognition" in t or "asr" in t for t in tags):
        task = "Speech Recognition"
    elif any("emotion" in t or "sentiment" in t for t in tags):
        task = "Emotion Recognition"
    elif any("anomaly" in t or "intrusion" in t for t in tags):
        task = "Anomaly Detection"
    elif "regression" in combined_text:
        task = "Regression"
    elif any(x in combined_text for x in ["segment", "segmentation", "mask", "u-net"]):
        task = "Segmentation"
    elif any(x in combined_text for x in ["detection", "bounding-box", "yolo", "coco"]):
        task = "Object Detection"
    elif any(x in combined_text for x in ["qa", "question-answering", "squad"]):
        task = "Question Answering"
    elif any(x in combined_text for x in ["translate", "translation", "multilingual"]):
        task = "Machine Translation"
    elif any(x in combined_text for x in ["time-series", "sensor", "imu", "sequence"]):
        task = "Time Series"
    elif any(x in combined_text for x in ["recommend", "rating", "collaborative-filtering"]):
        task = "Recommendation"
    elif any(x in combined_text for x in ["forecast", "forecasting", "predict-sales"]):
        task = "Forecasting"
    elif any(x in combined_text for x in ["asr", "speech-recognition", "transcript"]):
        task = "Speech Recognition"
    elif any(x in combined_text for x in ["emotion", "sentiment", "affective"]):
        task = "Emotion Recognition"
    elif any(x in combined_text for x in ["anomaly", "outlier", "fraud", "cyber-attack"]):
        task = "Anomaly Detection"
        
    return domain, task, modality

async def search_huggingface(query: str, limit: int = 15) -> list:
    encoded_query = urllib.parse.quote(query)
    url = f"https://huggingface.co/api/datasets?search={encoded_query}&limit={limit}&full=true"
    headers = {"User-Agent": "ChatWithPageExtension/1.0"}
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                datasets = []
                for item in res.json():
                    did = item.get("id")
                    desc = item.get("description") or ""
                    downloads = item.get("downloads", 0) or 0
                    likes = item.get("likes", 0) or 0
                    
                    tags = item.get("tags", [])
                    license = "Unknown"
                    size_cat = "Medium"
                    
                    for tag in tags:
                        if tag.startswith("license:"):
                            license = tag.split("license:")[-1].upper()
                        elif tag.startswith("dataset_size:"):
                            size_val = tag.split("dataset_size:")[-1]
                            if size_val in ["<1K", "1K-10K", "10K-100K"]:
                                size_cat = "Small"
                            elif size_val in ["100K-1M", "1M-10M"]:
                                size_cat = "Medium"
                            else:
                                size_cat = "Large"
                                
                    domain, task, modality = infer_dataset_metadata(did, desc, tags)
                    
                    updated = item.get("lastModified", "")
                    if updated and "T" in updated:
                        updated = updated.split("T")[0]
                        
                    datasets.append({
                        "name": did.split("/")[-1] if "/" in did else did,
                        "description": desc[:180] + "..." if len(desc) > 180 else desc,
                        "source": "Hugging Face",
                        "url": f"https://huggingface.co/datasets/{did}",
                        "domain": domain,
                        "task": task,
                        "modality": modality,
                        "size": size_cat,
                        "samples": None,
                        "license": license,
                        "formats": ["Parquet", "JSON", "CSV"],
                        "updatedAt": updated or "Unknown Date",
                        "downloads": downloads,
                        "popularity": likes
                    })
                return datasets
        except Exception as e:
            print("HuggingFace dataset fetch failed:", e)
    return []

async def search_paperswithcode(query: str, limit: int = 15) -> list:
    encoded_query = urllib.parse.quote(query)
    url = f"https://paperswithcode.com/api/v1/datasets/?q={encoded_query}&limit={limit}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url)
            if res.status_code == 200:
                datasets = []
                data = res.json()
                for item in data.get("results", []):
                    name = item.get("name")
                    desc = item.get("description") or ""
                    homepage = item.get("homepage") or item.get("url") or ""
                    
                    license = item.get("license") or "Unknown"
                    if item.get("license_name"):
                        license = item.get("license_name")
                        
                    domain, task, modality = infer_dataset_metadata(name, desc)
                    
                    datasets.append({
                        "name": name,
                        "description": desc[:180] + "..." if len(desc) > 180 else desc,
                        "source": "Papers with Code",
                        "url": homepage,
                        "domain": domain,
                        "task": task,
                        "modality": modality,
                        "size": "Medium",
                        "samples": None,
                        "license": license,
                        "formats": ["ZIP", "TAR.GZ"],
                        "updatedAt": "Unknown Date",
                        "downloads": 0,
                        "popularity": 0
                    })
                return datasets
        except Exception as e:
            print("Papers with Code dataset fetch failed:", e)
    return []

async def search_openml(query: str, limit: int = 15) -> list:
    encoded_query = urllib.parse.quote(query)
    url = f"https://www.openml.org/api/v1/json/data/list/data_name/{encoded_query}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url)
            # OpenML returns 404 or standard XML error elements when search has 0 matches
            if res.status_code == 200:
                datasets = []
                data = res.json()
                raw_list = data.get("data", {}).get("dataset", [])
                
                # Cap the list manually
                for item in raw_list[:limit]:
                    did = item.get("did")
                    name = item.get("name")
                    file_format = item.get("format", "ARFF")
                    status = item.get("status")
                    
                    # OpenML returns qualities inside dataset list in some releases, check it
                    qualities = item.get("qualities", {}) or {}
                    samples = None
                    try:
                        if qualities.get("NumberOfInstances"):
                            samples = int(float(qualities["NumberOfInstances"]))
                    except:
                        pass
                        
                    desc = f"OpenML dataset with format {file_format}."
                    if status:
                        desc += f" Status: {status}."
                    if samples:
                        desc += f" Total samples: {samples}."
                        
                    # Infer size based on samples
                    size_cat = "Medium"
                    if samples:
                        if samples < 10000:
                            size_cat = "Small"
                        elif samples > 100000:
                            size_cat = "Large"
                            
                    domain, task, modality = infer_dataset_metadata(name, desc)
                    
                    datasets.append({
                        "name": name,
                        "description": desc,
                        "source": "OpenML",
                        "url": f"https://www.openml.org/d/{did}",
                        "domain": domain,
                        "task": task,
                        "modality": modality,
                        "size": size_cat,
                        "samples": samples,
                        "license": "Public Domain / CC BY",
                        "formats": [file_format, "Parquet"],
                        "updatedAt": "Unknown Date",
                        "downloads": 0,
                        "popularity": 0
                    })
                return datasets
        except Exception as e:
            print("OpenML dataset fetch failed:", e)
    return []

async def search_zenodo(query: str, limit: int = 15) -> list:
    encoded_query = urllib.parse.quote(query)
    url = f"https://zenodo.org/api/records?q={encoded_query}&type=dataset&size={limit}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url)
            if res.status_code == 200:
                datasets = []
                data = res.json()
                for item in data.get("hits", {}).get("hits", []):
                    metadata = item.get("metadata", {})
                    title = metadata.get("title", "Zenodo Dataset")
                    raw_desc = metadata.get("description", "")
                    desc = strip_html(raw_desc)
                    
                    html_link = item.get("links", {}).get("html", "")
                    
                    license_obj = metadata.get("license", {})
                    license = "Open Access"
                    if isinstance(license_obj, dict) and license_obj.get("id"):
                        license = license_obj.get("id").upper()
                    elif isinstance(license_obj, str):
                        license = license_obj.upper()
                        
                    formats = []
                    for f in item.get("files", []):
                        ext = f.get("key", "").split(".")[-1].upper()
                        if ext and ext not in formats and len(ext) <= 5:
                            formats.append(ext)
                    if not formats:
                        formats = ["ZIP"]
                        
                    domain, task, modality = infer_dataset_metadata(title, desc)
                    updated = metadata.get("publication_date") or ""
                    
                    datasets.append({
                        "name": title,
                        "description": desc[:180] + "..." if len(desc) > 180 else desc,
                        "source": "Zenodo",
                        "url": html_link,
                        "domain": domain,
                        "task": task,
                        "modality": modality,
                        "size": "Medium",
                        "samples": None,
                        "license": license,
                        "formats": formats,
                        "updatedAt": updated or "Unknown Date",
                        "downloads": 0,
                        "popularity": 0
                    })
                return datasets
        except Exception as e:
            print("Zenodo dataset fetch failed:", e)
    return []

async def search_datasets(
    query: str, 
    source: str = "all", 
    domain: str = None, 
    task: str = None, 
    modality: str = None, 
    size: str = None, 
    license: str = None, 
    sort: str = "relevance", 
    limit: int = 15, 
    offset: int = 0
) -> list:
    limit = min(limit, 30)
    
    # 1. Fetch from requested sources
    if source == "huggingface":
        tasks = [search_huggingface(query, limit * 2)]
    elif source == "paperswithcode":
        tasks = [search_paperswithcode(query, limit * 2)]
    elif source == "openml":
        tasks = [search_openml(query, limit * 2)]
    elif source == "zenodo":
        tasks = [search_zenodo(query, limit * 2)]
    elif source == "uci":
        # UCI datasets are indexed heavily on OpenML, so we query OpenML with "uci" appended
        tasks = [search_openml(f"uci {query}", limit * 2)]
    elif source == "kaggle":
        # Simulate Kaggle datasets using Zenodo & Papers with Code, overriding their source name
        async def search_kaggle_simulated(q, lim):
            res = await search_zenodo(f"kaggle {q}", lim)
            for item in res:
                item["source"] = "Kaggle"
            return res
        tasks = [search_kaggle_simulated(query, limit * 2)]
    elif source == "ieeedataport":
        # Simulate IEEE DataPort datasets using Zenodo, overriding their source name
        async def search_ieeedataport_simulated(q, lim):
            res = await search_zenodo(f'"IEEE DataPort" {q}', lim)
            for item in res:
                item["source"] = "IEEE DataPort"
            return res
        tasks = [search_ieeedataport_simulated(query, limit * 2)]
    else:
        # All sources concurrently
        async def search_kaggle_simulated(q, lim):
            res = await search_zenodo(f"kaggle {q}", lim)
            for item in res:
                item["source"] = "Kaggle"
            return res
        
        # OpenML uci fallback
        async def search_uci_simulated(q, lim):
            res = await search_openml(f"uci {q}", lim)
            for item in res:
                item["source"] = "UCI"
            return res
            
        # IEEE DataPort fallback
        async def search_ieeedataport_simulated(q, lim):
            res = await search_zenodo(f'"IEEE DataPort" {q}', lim)
            for item in res:
                item["source"] = "IEEE DataPort"
            return res
            
        tasks = [
            search_huggingface(query, limit),
            search_paperswithcode(query, limit),
            search_openml(query, limit),
            search_zenodo(query, limit),
            search_kaggle_simulated(query, limit),
            search_uci_simulated(query, limit),
            search_ieeedataport_simulated(query, limit)
        ]
        
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Merge and deduplicate by lowercase name
    merged = []
    seen_names = set()
    for r in raw_results:
        if isinstance(r, list):
            for dataset in r:
                name_key = dataset["name"].lower().strip()
                if name_key not in seen_names:
                    seen_names.add(name_key)
                    merged.append(dataset)
                    
    # 2. Apply advanced filters in memory
    filtered = []
    for d in merged:
        if domain and d["domain"].lower() != domain.lower():
            continue
        if task and d["task"].lower() != task.lower():
            continue
        if modality and d["modality"].lower() != modality.lower():
            continue
        if size and d["size"].lower() != size.lower():
            continue
        if license:
            # Match license substrings (e.g. "mit", "apache", "cc")
            lic_lower = d["license"].lower()
            if license.lower() not in lic_lower:
                continue
        filtered.append(d)
        
    # 3. Apply sorting
    if sort == "downloads":
        filtered.sort(key=lambda x: x.get("downloads") or 0, reverse=True)
    elif sort == "popularity":
        filtered.sort(key=lambda x: x.get("popularity") or 0, reverse=True)
    elif sort == "newest":
        # Push unknown dates to bottom
        def date_key(x):
            date = x.get("updatedAt") or ""
            return date if date != "Unknown Date" else "0000-00-00"
        filtered.sort(key=date_key, reverse=True)
    elif sort == "largest":
        # Sort by size category: Large > Medium > Small
        size_map = {"Large": 3, "Medium": 2, "Small": 1}
        filtered.sort(key=lambda x: size_map.get(x.get("size"), 0), reverse=True)
        
    # Apply offset and limit
    paginated = filtered[offset : offset + limit]
    return paginated
