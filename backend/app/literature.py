import asyncio
import json
import urllib.parse
import xml.etree.ElementTree as ET
import re
import httpx

# Reconstruct OpenAlex abstract from inverted index
def reconstruct_abstract(abstract_inverted_index: dict) -> str:
    if not abstract_inverted_index:
        return ""
    try:
        max_idx = 0
        for indices in abstract_inverted_index.values():
            for idx in indices:
                if idx > max_idx:
                    max_idx = idx
        
        words = [""] * (max_idx + 1)
        for word, indices in abstract_inverted_index.items():
            for idx in indices:
                words[idx] = word
        return " ".join(words).strip()
    except Exception:
        return ""

# Parse arXiv XML response
def parse_arxiv_xml(xml_content: str) -> list:
    papers = []
    try:
        root = ET.fromstring(xml_content)
        ns = {
            'atom': 'http://www.w3.org/2005/Atom',
            'arxiv': 'http://arxiv.org/schemas/atom'
        }
        for entry in root.findall('atom:entry', ns):
            title_node = entry.find('atom:title', ns)
            title = " ".join(title_node.text.split()) if title_node is not None and title_node.text else "Unknown"
            
            authors = []
            for author in entry.findall('atom:author', ns):
                name_node = author.find('atom:name', ns)
                if name_node is not None and name_node.text:
                    authors.append(name_node.text.strip())
            
            published_node = entry.find('atom:published', ns)
            year = None
            if published_node is not None and published_node.text:
                try:
                    year = int(published_node.text.split('-')[0])
                except:
                    pass
            
            summary_node = entry.find('atom:summary', ns)
            abstract = " ".join(summary_node.text.split()) if summary_node is not None and summary_node.text else ""
            
            id_node = entry.find('atom:id', ns)
            arxiv_url = id_node.text.strip() if id_node is not None and id_node.text else ""
            code = arxiv_url.split('/abs/')[-1].split('v')[0] if '/abs/' in arxiv_url else ""
            
            pdf_link = ""
            for link in entry.findall('atom:link', ns):
                rel = link.attrib.get('rel')
                title_attr = link.attrib.get('title')
                href = link.attrib.get('href')
                if rel == 'related' and title_attr == 'pdf':
                    pdf_link = href
                elif href and 'pdf' in href:
                    pdf_link = href
            if not pdf_link and code:
                pdf_link = f"https://arxiv.org/pdf/{code}.pdf"
            
            doi_node = entry.find('arxiv:doi', ns)
            doi = doi_node.text.strip() if doi_node is not None and doi_node.text else ""
            
            journal_node = entry.find('arxiv:journal_ref', ns)
            venue = journal_node.text.strip() if journal_node is not None and journal_node.text else "arXiv"
            
            papers.append({
                "id": f"arxiv:{code}" if code else arxiv_url,
                "title": title,
                "authors": authors,
                "year": year,
                "abstract": abstract,
                "venue": venue,
                "citationCount": 0,
                "pdfLink": pdf_link,
                "source": "arXiv",
                "doi": doi,
                "externalIds": {
                    "arxiv": code,
                    "doi": doi
                }
            })
    except Exception as e:
        print("Error parsing arXiv XML:", e)
    return papers

async def search_arxiv(query: str, offset: int = 0, limit: int = 10) -> list:
    encoded_query = urllib.parse.quote(query)
    url = f"http://export.arxiv.org/api/query?search_query=all:{encoded_query}&start={offset}&max_results={limit}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url)
            if res.status_code == 200:
                return parse_arxiv_xml(res.text)
        except Exception as e:
            print("ArXiv fetch failed:", e)
    return []

async def search_semanticscholar(
    query: str, 
    limit: int = 10, 
    offset: int = 0, 
    sort: str = None, 
    open_access: bool = False, 
    year: str = None
) -> list:
    fields = "paperId,title,authors,year,abstract,venue,citationCount,openAccessPdf,externalIds"
    encoded_query = urllib.parse.quote(query)
    url = f"https://api.semanticscholar.org/graph/v1/paper/search?query={encoded_query}&limit={limit}&offset={offset}&fields={fields}"
    
    # Apply filters
    if open_access:
        url += "&openAccessPdf=true"
    if year:
        url += f"&year={year}"
    if sort == "newest":
        url += "&sort=paperDate:desc"
    elif sort == "citations":
        url += "&sort=citationCount:desc"

    headers = {"User-Agent": "ChatWithPageExtension/1.0"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                results = []
                for paper in data.get("data", []):
                    authors = [a.get("name") for a in paper.get("authors", []) if a.get("name")]
                    pdf_link = paper.get("openAccessPdf", {})
                    pdf_url = pdf_link.get("url") if pdf_link else ""
                    
                    external_ids = paper.get("externalIds", {})
                    doi = external_ids.get("DOI", "")
                    arxiv_id = external_ids.get("ArXiv", "")
                    
                    results.append({
                        "id": paper.get("paperId"),
                        "title": paper.get("title", "Unknown"),
                        "authors": authors,
                        "year": paper.get("year"),
                        "abstract": paper.get("abstract") or "",
                        "venue": paper.get("venue") or "Semantic Scholar",
                        "citationCount": paper.get("citationCount") or 0,
                        "pdfLink": pdf_url,
                        "source": "Semantic Scholar",
                        "doi": doi,
                        "externalIds": {
                            "arxiv": arxiv_id,
                            "doi": doi,
                            "semanticScholar": paper.get("paperId")
                        }
                    })
                return results
        except Exception as e:
            print("Semantic Scholar fetch failed:", e)
    return []

async def search_openalex(
    query: str, 
    limit: int = 10, 
    page: int = 1, 
    sort: str = None, 
    open_access: bool = False, 
    year: str = None
) -> list:
    encoded_query = urllib.parse.quote(query)
    url = f"https://api.openalex.org/works?search={encoded_query}&per_page={limit}&page={page}"
    
    filters = []
    if open_access:
        filters.append("is_oa:true")
    if year:
        filters.append(f"publication_year:{year}")
    
    if filters:
        url += f"&filter={','.join(filters)}"
        
    if sort == "newest":
        url += "&sort=publication_year:desc"
    elif sort == "citations":
        url += "&sort=cited_by_count:desc"
        
    headers = {
        "User-Agent": "ChatWithPageExtension/1.0 (mailto:fahim@example.com)"
    }
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                results = []
                for work in data.get("results", []):
                    authors = []
                    for auth_item in work.get("authorships", []):
                        author = auth_item.get("author", {})
                        if author.get("display_name"):
                            authors.append(author.get("display_name"))
                            
                    primary_location = work.get("primary_location", {}) or {}
                    pdf_url = primary_location.get("pdf_url") or ""
                    
                    abstract = reconstruct_abstract(work.get("abstract_inverted_index"))
                    
                    venue = "OpenAlex"
                    source_info = primary_location.get("source", {})
                    if source_info and source_info.get("display_name"):
                        venue = source_info.get("display_name")
                    
                    results.append({
                        "id": work.get("id"),
                        "title": work.get("title", "Unknown"),
                        "authors": authors,
                        "year": work.get("publication_year"),
                        "abstract": abstract,
                        "venue": venue,
                        "citationCount": work.get("cited_by_count") or 0,
                        "pdfLink": pdf_url,
                        "source": "OpenAlex",
                        "doi": work.get("doi", ""),
                        "externalIds": {
                            "doi": work.get("doi", ""),
                            "openAlex": work.get("id")
                        }
                    })
                return results
        except Exception as e:
            print("OpenAlex fetch failed:", e)
    return []

async def get_similar_papers(paper_id: str, limit: int = 10) -> list:
    # If the ID starts with arxiv: or doi:, Semantic Scholar API supports resolving it
    resolved_id = paper_id
    if paper_id.startswith("arxiv:"):
        resolved_id = f"ARXIV:{paper_id.split('arxiv:')[-1]}"
    elif paper_id.startswith("doi:") or (not paper_id.startswith("http") and "/" in paper_id):
        clean_doi = paper_id.split("doi:")[-1]
        resolved_id = f"DOI:{clean_doi}"
        
    fields = "paperId,title,authors,year,abstract,venue,citationCount,openAccessPdf,externalIds"
    url = f"https://api.semanticscholar.org/recommendations/v1/papers/forpaper/{resolved_id}?fields={fields}&limit={limit}"
    
    headers = {"User-Agent": "ChatWithPageExtension/1.0"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                results = []
                for paper in data.get("recommendedPapers", []):
                    authors = [a.get("name") for a in paper.get("authors", []) if a.get("name")]
                    pdf_link = paper.get("openAccessPdf", {})
                    pdf_url = pdf_link.get("url") if pdf_link else ""
                    
                    external_ids = paper.get("externalIds", {})
                    doi = external_ids.get("DOI", "")
                    arxiv_id = external_ids.get("ArXiv", "")
                    
                    results.append({
                        "id": paper.get("paperId"),
                        "title": paper.get("title", "Unknown"),
                        "authors": authors,
                        "year": paper.get("year"),
                        "abstract": paper.get("abstract") or "",
                        "venue": paper.get("venue") or "Semantic Scholar",
                        "citationCount": paper.get("citationCount") or 0,
                        "pdfLink": pdf_url,
                        "source": "Semantic Scholar",
                        "doi": doi,
                        "externalIds": {
                            "arxiv": arxiv_id,
                            "doi": doi,
                            "semanticScholar": paper.get("paperId")
                        }
                    })
                return results
            else:
                # If recommendations fail or resolved_id is invalid, try fallback keywords search
                print(f"Recommendations failed with status {res.status_code}")
        except Exception as e:
            print("Recommendations fetch failed:", e)
    return []

async def get_author_details(author_query_or_id: str) -> dict:
    is_numeric_id = author_query_or_id.isdigit()
    fields = "name,aliases,citationCount,hIndex,paperCount,papers.title,papers.year,papers.venue,papers.externalIds,papers.paperId"
    
    if is_numeric_id:
        url = f"https://api.semanticscholar.org/graph/v1/author/{author_query_or_id}?fields={fields}"
    else:
        encoded_query = urllib.parse.quote(author_query_or_id)
        url = f"https://api.semanticscholar.org/graph/v1/author/search?query={encoded_query}&fields={fields}&limit=1"
        
    headers = {"User-Agent": "ChatWithPageExtension/1.0"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                author_data = data
                if not is_numeric_id:
                    authors_list = data.get("data", [])
                    if not authors_list:
                        return {}
                    author_data = authors_list[0]
                    
                papers = []
                for p in author_data.get("papers", []) or []:
                    external_ids = p.get("externalIds", {}) or {}
                    papers.append({
                        "id": p.get("paperId"),
                        "title": p.get("title", "Unknown"),
                        "year": p.get("year"),
                        "venue": p.get("venue") or "Conference/Journal",
                        "doi": external_ids.get("DOI", ""),
                        "arxiv": external_ids.get("ArXiv", "")
                    })
                
                # Sort papers by year descending
                papers.sort(key=lambda x: x.get("year") or 0, reverse=True)
                
                return {
                    "authorId": author_data.get("authorId"),
                    "name": author_data.get("name"),
                    "aliases": author_data.get("aliases", []),
                    "citationCount": author_data.get("citationCount") or 0,
                    "hIndex": author_data.get("hIndex") or 0,
                    "paperCount": author_data.get("paperCount") or 0,
                    "papers": papers
                }
        except Exception as e:
            print("Author fetch failed:", e)
    return {}

async def get_trending_papers(limit: int = 10) -> list:
    # Fetch top-cited papers from the past year via OpenAlex
    import datetime
    last_year = datetime.datetime.now().year - 1
    url = f"https://api.openalex.org/works?filter=publication_year:{last_year}&sort=cited_by_count:desc&per_page={limit}"
    
    headers = {
        "User-Agent": "ChatWithPageExtension/1.0 (mailto:fahim@example.com)"
    }
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                results = []
                for work in data.get("results", []):
                    authors = []
                    for auth_item in work.get("authorships", []):
                        author = auth_item.get("author", {})
                        if author.get("display_name"):
                            authors.append(author.get("display_name"))
                            
                    primary_location = work.get("primary_location", {}) or {}
                    pdf_url = primary_location.get("pdf_url") or ""
                    
                    abstract = reconstruct_abstract(work.get("abstract_inverted_index"))
                    
                    venue = "OpenAlex"
                    source_info = primary_location.get("source", {})
                    if source_info and source_info.get("display_name"):
                        venue = source_info.get("display_name")
                        
                    results.append({
                        "id": work.get("id"),
                        "title": work.get("title", "Unknown"),
                        "authors": authors,
                        "year": work.get("publication_year"),
                        "abstract": abstract,
                        "venue": venue,
                        "citationCount": work.get("cited_by_count") or 0,
                        "pdfLink": pdf_url,
                        "source": "OpenAlex",
                        "doi": work.get("doi", ""),
                        "externalIds": {
                            "doi": work.get("doi", ""),
                            "openAlex": work.get("id")
                        }
                    })
                return results
        except Exception as e:
            print("Trending papers fetch failed:", e)
    return []


async def search_ieee_xplore(query: str, api_key: str = None, limit: int = 10, offset: int = 0) -> list:
    if api_key:
        encoded_query = urllib.parse.quote(query)
        # start_record is 1-indexed in IEEE Xplore API
        url = f"https://ieeexploreapi.ieee.org/api/v1.0/query/search?apikey={api_key}&querytext={encoded_query}&max_results={limit}&start_record={offset + 1}"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res = await client.get(url)
                if res.status_code == 200:
                    data = res.json()
                    results = []
                    for art in data.get("articles", []) or []:
                        authors_info = art.get("authors", {}) or {}
                        authors = [a.get("full_name") for a in authors_info.get("authors", []) or [] if a.get("full_name")]
                        
                        pdf_url = art.get("pdf_url") or art.get("document_link") or ""
                        
                        results.append({
                            "id": art.get("doi") or art.get("article_number") or "",
                            "title": art.get("title", "Unknown"),
                            "authors": authors,
                            "year": int(art.get("publication_year")) if art.get("publication_year") else None,
                            "abstract": art.get("abstract") or "",
                            "venue": art.get("publication_title") or "IEEE Xplore",
                            "citationCount": art.get("citing_paper_count") or 0,
                            "pdfLink": pdf_url,
                            "source": "IEEE Xplore",
                            "doi": art.get("doi") or "",
                            "externalIds": {
                                "doi": art.get("doi") or "",
                                "ieee": art.get("article_number")
                            }
                        })
                    return results
            except Exception as e:
                print("IEEE Xplore direct query failed:", e)
                
    # Fallback: Query OpenAlex with IEEE publisher filter (IEEE publisher source id is S193026660)
    # If not found or API key omitted, this provides genuine IEEE papers keylessly!
    encoded_query = urllib.parse.quote(query)
    page = (offset // limit) + 1
    url = f"https://api.openalex.org/works?search={encoded_query}&filter=primary_location.source.id:S193026660&per_page={limit}&page={page}"
    headers = {"User-Agent": "ChatWithPageExtension/1.0"}
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                results = []
                for work in data.get("results", []) or []:
                    authors = [auth_item.get("author", {}).get("display_name") for auth_item in work.get("authorships", []) or [] if auth_item.get("author", {}).get("display_name")]
                    primary_loc = work.get("primary_location", {}) or {}
                    pdf_url = primary_loc.get("pdf_url") or ""
                    venue = "IEEE Xplore"
                    if primary_loc.get("source", {}).get("display_name"):
                        venue = primary_loc["source"]["display_name"]
                        
                    results.append({
                        "id": work.get("id"),
                        "title": work.get("title", "Unknown"),
                        "authors": authors,
                        "year": work.get("publication_year"),
                        "abstract": reconstruct_abstract(work.get("abstract_inverted_index")),
                        "venue": venue,
                        "citationCount": work.get("cited_by_count") or 0,
                        "pdfLink": pdf_url,
                        "source": "IEEE Xplore (OpenAlex)",
                        "doi": work.get("doi", ""),
                        "externalIds": {
                            "doi": work.get("doi", ""),
                            "openAlex": work.get("id")
                        }
                    })
                return results
        except Exception as e:
            print("IEEE Xplore OpenAlex fallback query failed:", e)
    return []


async def search_google_scholar(query: str, api_key: str = None, limit: int = 10, offset: int = 0) -> list:
    if not api_key:
        # Return a custom marker indicating configuration is required
        return [{"id": "SCHOLAR_KEY_REQUIRED", "title": "SerpAPI Key Required", "authors": [], "year": None, "abstract": "", "venue": "", "citationCount": 0, "pdfLink": "", "source": "Google Scholar", "doi": ""}]
        
    encoded_query = urllib.parse.quote(query)
    url = f"https://serpapi.com/search.json?engine=google_scholar&q={encoded_query}&api_key={api_key}&num={limit}&start={offset}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url)
            if res.status_code == 200:
                data = res.json()
                results = []
                for item in data.get("organic_results", []) or []:
                    title = item.get("title", "Unknown")
                    snippet = item.get("snippet", "")
                    
                    pub_info = item.get("publication_info", {}) or {}
                    authors_list = pub_info.get("authors", []) or []
                    authors = [a.get("name") for a in authors_list if a.get("name")]
                    if not authors and pub_info.get("summary"):
                        # Try parsing from summary string (e.g. "J Doe, K Smith - Journal of AI, 2020 - Elsevier")
                        summary = pub_info["summary"]
                        parts = summary.split(" - ")
                        if parts:
                            authors = [name.strip() for name in parts[0].split(",")]
                            
                    year = None
                    try:
                        # Extract 4 digit year from summary string
                        if pub_info.get("summary"):
                            year_match = re.search(r'\b(19|20)\d{2}\b', pub_info["summary"])
                            if year_match:
                                year = int(year_match.group(0))
                    except:
                        pass
                        
                    venue = "Google Scholar"
                    if pub_info.get("summary"):
                        parts = pub_info["summary"].split(" - ")
                        if len(parts) > 1:
                            venue = parts[1].strip()
                            
                    citation_count = 0
                    inline_links = item.get("inline_links", {}) or {}
                    cited_by = inline_links.get("cited_by", {}) or {}
                    if cited_by.get("total"):
                        citation_count = int(cited_by["total"])
                        
                    pdf_url = ""
                    resources = item.get("resources", []) or []
                    if resources and resources[0].get("link"):
                        pdf_url = resources[0]["link"]
                    else:
                        pdf_url = item.get("link") or ""
                        
                    results.append({
                        "id": item.get("result_id") or "",
                        "title": title,
                        "authors": authors,
                        "year": year,
                        "abstract": snippet,
                        "venue": venue,
                        "citationCount": citation_count,
                        "pdfLink": pdf_url,
                        "source": "Google Scholar",
                        "doi": "",
                        "externalIds": {
                            "scholar": item.get("result_id")
                        }
                    })
                return results
        except Exception as e:
            print("Google Scholar SerpAPI query failed:", e)
    return []


async def search_scientific_data(query: str, limit: int = 10, offset: int = 0) -> list:
    # Query OpenAlex specifically for Nature Scientific Data (ISSN: 2052-4463)
    encoded_query = urllib.parse.quote(query)
    page = (offset // limit) + 1
    url = f"https://api.openalex.org/works?search={encoded_query}&filter=locations.source.issn:2052-4463&per_page={limit}&page={page}"
    headers = {"User-Agent": "ChatWithPageExtension/1.0"}
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                results = []
                for work in data.get("results", []) or []:
                    authors = [auth_item.get("author", {}).get("display_name") for auth_item in work.get("authorships", []) or [] if auth_item.get("author", {}).get("display_name")]
                    primary_loc = work.get("primary_location", {}) or {}
                    pdf_url = primary_loc.get("pdf_url") or ""
                    
                    results.append({
                        "id": work.get("id"),
                        "title": work.get("title", "Unknown"),
                        "authors": authors,
                        "year": work.get("publication_year"),
                        "abstract": reconstruct_abstract(work.get("abstract_inverted_index")),
                        "venue": "Scientific Data (Nature)",
                        "citationCount": work.get("cited_by_count") or 0,
                        "pdfLink": pdf_url,
                        "source": "Scientific Data (Nature)",
                        "doi": work.get("doi", ""),
                        "externalIds": {
                            "doi": work.get("doi", ""),
                            "openAlex": work.get("id")
                        }
                    })
                return results
        except Exception as e:
            print("Scientific Data OpenAlex query failed:", e)
    return []

