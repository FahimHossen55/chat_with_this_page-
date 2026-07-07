import pytest
import respx
import httpx

@respx.mock
def test_literature_search_semanticscholar(client):
    # Mock Semantic Scholar Search
    mock_url = "https://api.semanticscholar.org/graph/v1/paper/search"
    mock_data = {
        "total": 1,
        "offset": 0,
        "data": [
            {
                "paperId": "mock-id-123",
                "title": "Mock Deep Learning Paper",
                "year": 2023,
                "abstract": "This is a mock abstract for deep learning.",
                "venue": "CVPR",
                "citationCount": 55,
                "openAccessPdf": {"url": "https://example.com/mock.pdf"},
                "authors": [{"name": "Auth One"}, {"name": "Auth Two"}],
                "externalIds": {"DOI": "10.1234/mock", "ArXiv": "2301.0001"}
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/literature/search?query=deep+learning&source=semanticscholar")
    assert response.status_code == 200
    res = response.json()
    assert "results" in res
    assert len(res["results"]) == 1
    paper = res["results"][0]
    assert paper["id"] == "mock-id-123"
    assert paper["title"] == "Mock Deep Learning Paper"
    assert paper["source"] == "Semantic Scholar"
    assert paper["citationCount"] == 55
    assert paper["pdfLink"] == "https://example.com/mock.pdf"
    assert "Auth One" in paper["authors"]

@respx.mock
def test_literature_search_arxiv(client):
    # Mock arXiv XML Feed API
    mock_url = "http://export.arxiv.org/api/query"
    mock_xml = """<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry>
        <id>http://arxiv.org/abs/2301.0001v1</id>
        <title>Mock Arxiv Title</title>
        <summary>Mock summary for arxiv paper.</summary>
        <published>2023-01-15T10:00:00Z</published>
        <author><name>Arxiv Author</name></author>
        <link rel="related" title="pdf" href="https://arxiv.org/pdf/2301.0001.pdf"/>
        <arxiv:doi>10.1234/arxiv-mock</arxiv:doi>
        <arxiv:journal_ref>IEEE</arxiv:journal_ref>
      </entry>
    </feed>
    """
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, content=mock_xml)
    )

    response = client.get("/literature/search?query=arxiv&source=arxiv")
    assert response.status_code == 200
    res = response.json()
    assert "results" in res
    assert len(res["results"]) == 1
    paper = res["results"][0]
    assert paper["title"] == "Mock Arxiv Title"
    assert "arxiv:2301.0001" in paper["id"]
    assert paper["source"] == "arXiv"
    assert paper["pdfLink"] == "https://arxiv.org/pdf/2301.0001.pdf"
    assert "Arxiv Author" in paper["authors"]

@respx.mock
def test_literature_search_openalex(client):
    # Mock OpenAlex Works API
    mock_url = "https://api.openalex.org/works"
    mock_data = {
        "results": [
            {
                "id": "https://openalex.org/W12345",
                "title": "OpenAlex Mock Work",
                "publication_year": 2024,
                "cited_by_count": 12,
                "doi": "https://doi.org/10.1234/openalex-mock",
                "authorships": [
                    {"author": {"display_name": "OpenAlex Author"}}
                ],
                "primary_location": {
                    "pdf_url": "https://openalex.org/mock.pdf",
                    "source": {"display_name": "Nature Communications"}
                },
                "abstract_inverted_index": {
                    "Reconstructed": [0],
                    "abstract": [1]
                }
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/literature/search?query=openalex&source=openalex")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    paper = res["results"][0]
    assert paper["title"] == "OpenAlex Mock Work"
    assert paper["venue"] == "Nature Communications"
    assert paper["abstract"] == "Reconstructed abstract"
    assert paper["pdfLink"] == "https://openalex.org/mock.pdf"
    assert "OpenAlex Author" in paper["authors"]

@respx.mock
def test_literature_similar(client):
    # Mock Semantic Scholar Recommendations
    mock_url = "https://api.semanticscholar.org/recommendations/v1/papers/forpaper"
    mock_data = {
        "recommendedPapers": [
            {
                "paperId": "sim-id-999",
                "title": "Similar Academic Work",
                "year": 2022,
                "abstract": "Similar paper summary.",
                "venue": "NIPS",
                "citationCount": 150,
                "openAccessPdf": None,
                "authors": [{"name": "Similar Auth"}],
                "externalIds": {"DOI": "10.1234/sim-mock"}
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/literature/similar?paper_id=mock-id-123&limit=5")
    assert response.status_code == 200
    res = response.json()
    assert "results" in res
    assert len(res["results"]) == 1
    paper = res["results"][0]
    assert paper["title"] == "Similar Academic Work"
    assert paper["citationCount"] == 150

@respx.mock
def test_literature_trending(client):
    # Mock OpenAlex works for trending papers query
    mock_url = "https://api.openalex.org/works"
    mock_data = {
        "results": [
            {
                "id": "https://openalex.org/W_TREND",
                "title": "Trending Paper Title",
                "publication_year": 2025,
                "cited_by_count": 980,
                "authorships": [{"author": {"display_name": "AI Star"}}],
                "primary_location": {"pdf_url": "https://trending.com/paper.pdf", "source": {"display_name": "NeurIPS"}},
                "abstract_inverted_index": {"Hot": [0], "topic": [1]}
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/literature/trending?limit=5")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    paper = res["results"][0]
    assert paper["title"] == "Trending Paper Title"
    assert paper["citationCount"] == 980
    assert paper["venue"] == "NeurIPS"

@respx.mock
def test_literature_author(client):
    # Mock Semantic Scholar Author details
    mock_url = "https://api.semanticscholar.org/graph/v1/author/search"
    mock_data = {
        "data": [
            {
                "authorId": "auth-54321",
                "name": "Prof. Test Scientist",
                "aliases": ["P. T. Scientist"],
                "citationCount": 9999,
                "hIndex": 42,
                "paperCount": 150,
                "papers": [
                    {
                        "paperId": "paper-1",
                        "title": "Historical Foundation Paper",
                        "year": 2018,
                        "venue": "Nature",
                        "externalIds": {"DOI": "10.1038/nature1"}
                    }
                ]
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/literature/author?query=Prof.+Test+Scientist")
    assert response.status_code == 200
    res = response.json()
    assert res["authorId"] == "auth-54321"
    assert res["name"] == "Prof. Test Scientist"
    assert res["hIndex"] == 42
    assert len(res["papers"]) == 1
    assert res["papers"][0]["title"] == "Historical Foundation Paper"


@respx.mock
def test_literature_search_ieee_with_key(client):
    # Mock IEEE Xplore API
    mock_url = "https://ieeexploreapi.ieee.org/api/v1.0/query/search"
    mock_data = {
        "total_records": 1,
        "articles": [
            {
                "title": "IEEE Test Article",
                "authors": {"authors": [{"full_name": "IEEE Author"}]},
                "publication_year": "2024",
                "abstract": "IEEE abstract text.",
                "publication_title": "IEEE Transactions on Fuzzy Systems",
                "citing_paper_count": 14,
                "doi": "10.1109/TFUZZ.2024.123",
                "article_number": "987654"
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/literature/search?query=fuzzy&source=ieee&ieee_api_key=my-ieee-key")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    paper = res["results"][0]
    assert paper["title"] == "IEEE Test Article"
    assert paper["source"] == "IEEE Xplore"
    assert paper["citationCount"] == 14
    assert "IEEE Author" in paper["authors"]

@respx.mock
def test_literature_search_ieee_keyless_fallback(client):
    # Mock OpenAlex publisher filter
    mock_url = "https://api.openalex.org/works"
    mock_data = {
        "results": [
            {
                "id": "https://openalex.org/W999",
                "title": "IEEE Keyless Article",
                "authorships": [{"author": {"display_name": "Fallback Author"}}],
                "publication_year": 2023,
                "abstract_inverted_index": {"Abstract": [0], "text": [1]},
                "primary_location": {
                    "pdf_url": "https://example.com/ieee-keyless.pdf",
                    "source": {"display_name": "IEEE Access"}
                },
                "cited_by_count": 5,
                "doi": "10.1109/ACCESS.2023.999"
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/literature/search?query=neural&source=ieee")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    paper = res["results"][0]
    assert paper["title"] == "IEEE Keyless Article"
    assert paper["source"] == "IEEE Xplore (OpenAlex)"
    assert paper["citationCount"] == 5

@respx.mock
def test_literature_search_scholar_keyless(client):
    response = client.get("/literature/search?query=quantum&source=scholar")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    assert res["results"][0]["id"] == "SCHOLAR_KEY_REQUIRED"

@respx.mock
def test_literature_search_scholar_with_key(client):
    # Mock SerpAPI Google Scholar
    mock_url = "https://serpapi.com/search.json"
    mock_data = {
        "organic_results": [
            {
                "result_id": "scholar-id-777",
                "title": "Scholar Google Quantum Paper",
                "snippet": "Scholar snippet content",
                "publication_info": {
                    "summary": "J Doe, K Smith - Journal of Quantum, 2022 - Elsevier"
                },
                "inline_links": {
                    "cited_by": {"total": 120}
                },
                "resources": [
                    {"link": "https://example.com/scholar.pdf"}
                ]
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/literature/search?query=quantum&source=scholar&serp_api_key=my-serp-key")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    paper = res["results"][0]
    assert paper["title"] == "Scholar Google Quantum Paper"
    assert paper["source"] == "Google Scholar"
    assert paper["citationCount"] == 120
    assert paper["year"] == 2022
    assert "J Doe" in paper["authors"]

@respx.mock
def test_literature_search_scientificdata(client):
    # Mock OpenAlex scientific data ISSN filter (Nature ISSN: 2052-4463)
    mock_url = "https://api.openalex.org/works"
    mock_data = {
        "results": [
            {
                "id": "https://openalex.org/W777",
                "title": "Scientific Data MRI Dataset Paper",
                "authorships": [{"author": {"display_name": "Nature Researcher"}}],
                "publication_year": 2024,
                "abstract_inverted_index": {"Scientific": [0], "data": [1]},
                "primary_location": {
                    "pdf_url": "https://example.com/nature.pdf",
                    "source": {"display_name": "Scientific Data"}
                },
                "cited_by_count": 8,
                "doi": "10.1038/sdata.2024.777"
            }
        ]
    }
    respx.get(url__startswith=mock_url).mock(
        return_value=httpx.Response(200, json=mock_data)
    )

    response = client.get("/literature/search?query=mri&source=scientificdata")
    assert response.status_code == 200
    res = response.json()
    assert len(res["results"]) == 1
    paper = res["results"][0]
    assert paper["title"] == "Scientific Data MRI Dataset Paper"
    assert paper["source"] == "Scientific Data (Nature)"
    assert paper["citationCount"] == 8

