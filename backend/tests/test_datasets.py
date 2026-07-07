import pytest
import respx
import httpx

@respx.mock
def test_dataset_search_huggingface(client):
    # Mock Hugging Face datasets API
    mock_url = "https://huggingface.co/api/datasets"
    mock_data = [
        {
            "id": "mock-user/brain-mri",
            "description": "A dataset of brain tumor MRI scans.",
            "downloads": 1200,
            "likes": 88,
            "lastModified": "2023-04-10T12:00:00Z",
            "tags": [
                "task_categories:image-segmentation",
                "license:mit",
                "dataset_size:10K-100K",
                "modality:image"
            ]
        }
    ]
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/datasets/search?query=brain+mri&source=huggingface")
    assert response.status_code == 200
    res = response.json()
    assert "results" in res
    assert len(res["results"]) == 1
    ds = res["results"][0]
    assert ds["name"] == "brain-mri"
    assert ds["source"] == "Hugging Face"
    assert ds["domain"] == "Healthcare"
    assert ds["task"] == "Segmentation"
    assert ds["modality"] == "Image"
    assert ds["license"] == "MIT"
    assert ds["downloads"] == 1200
    assert ds["url"] == "https://huggingface.co/datasets/mock-user/brain-mri"

@respx.mock
def test_dataset_search_openml(client):
    # Mock OpenML datasets API
    mock_url = "https://www.openml.org/api/v1/json/data/list/data_name"
    mock_data = {
        "data": {
            "dataset": [
                {
                    "did": "42",
                    "name": "uci-iris",
                    "format": "ARFF",
                    "status": "active",
                    "version": "1",
                    "qualities": {
                        "NumberOfInstances": "150.0",
                        "NumberOfFeatures": "5.0"
                    }
                }
            ]
        }
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/datasets/search?query=iris&source=openml")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    ds = res["results"][0]
    assert ds["name"] == "uci-iris"
    assert ds["source"] == "OpenML"
    assert ds["samples"] == 150
    assert ds["size"] == "Small"
    assert ds["url"] == "https://www.openml.org/d/42"

@respx.mock
def test_dataset_search_zenodo(client):
    # Mock Zenodo datasets API
    mock_url = "https://zenodo.org/api/records"
    mock_data = {
        "hits": {
            "hits": [
                {
                    "metadata": {
                        "title": "Zenodo Climate Tabular Data",
                        "description": "<p>This is a <b>climate</b> dataset.</p>",
                        "license": {"id": "CC-BY-4.0"},
                        "publication_date": "2024-05-15"
                    },
                    "links": {
                        "html": "https://zenodo.org/record/12345"
                    },
                    "files": [
                        {"key": "climate_data.csv"}
                    ]
                }
            ]
        }
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/datasets/search?query=climate&source=zenodo")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    ds = res["results"][0]
    assert ds["name"] == "Zenodo Climate Tabular Data"
    assert ds["source"] == "Zenodo"
    assert "climate" in ds["description"].lower()
    assert "CSV" in ds["formats"]
    assert ds["license"] == "CC-BY-4.0"

@respx.mock
def test_dataset_search_paperswithcode(client):
    # Mock Papers with Code datasets API
    mock_url = "https://paperswithcode.com/api/v1/datasets"
    mock_data = {
        "results": [
            {
                "name": "SQuAD v2.0",
                "description": "Stanford Question Answering Dataset",
                "url": "https://rajpurkar.github.io/SQuAD-explorer/",
                "license_name": "CC BY-SA 4.0"
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/datasets/search?query=squad&source=paperswithcode")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    ds = res["results"][0]
    assert ds["name"] == "SQuAD v2.0"
    assert ds["task"] == "Question Answering"
    assert ds["license"] == "CC BY-SA 4.0"
