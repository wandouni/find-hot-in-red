def test_ingest_single_note(client):
    payload = {
        "notes": [{
            "id": "note_001",
            "keyword": "职场副业",
            "title": "我靠副业月入2万",
            "content": "分享我的经历...",
            "author": "小明",
            "author_id": "user_123",
            "likes": 1500,
            "collects": 800,
            "publish_date": "2024-01-15",
            "url": "https://www.xiaohongshu.com/explore/note_001",
            "source": "dom",
            "comments": [
                {"id": "c_001", "note_id": "note_001", "content": "太厉害了", "likes": 50, "rank": 1},
                {"id": "c_002", "note_id": "note_001", "content": "怎么做到的", "likes": 30, "rank": 2},
            ]
        }]
    }
    resp = client.post("/api/notes", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["inserted"] == 1
    assert data["updated"] == 0


def test_ingest_upsert_duplicate(client):
    payload = {
        "notes": [{
            "id": "note_001",
            "keyword": "职场副业",
            "title": "标题",
            "content": "内容",
            "author": "作者",
            "author_id": "user_1",
            "likes": 100,
            "collects": 50,
            "comments": []
        }]
    }
    client.post("/api/notes", json=payload)
    # Second POST same id — should upsert (update), not fail
    payload["notes"][0]["likes"] = 200
    resp = client.post("/api/notes", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] == 1
    assert data["inserted"] == 0


def test_ingest_multiple_notes(client):
    notes = [
        {"id": f"note_{i}", "keyword": "测试", "title": f"标题{i}", "content": f"内容{i}",
         "author": "作者", "author_id": f"u_{i}", "likes": i * 10, "collects": i * 5, "comments": []}
        for i in range(5)
    ]
    resp = client.post("/api/notes", json={"notes": notes})
    assert resp.status_code == 200
    assert resp.json()["inserted"] == 5
