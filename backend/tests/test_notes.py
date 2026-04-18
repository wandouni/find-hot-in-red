def _seed(client, n=3):
    notes = [
        {
            "id": f"note_{i}",
            "keyword": "副业" if i % 2 == 0 else "职场",
            "title": f"标题{i}",
            "content": f"正文内容{i}，详细描述...",
            "author": f"作者{i}",
            "author_id": f"u_{i}",
            "likes": (i + 1) * 100,
            "collects": (i + 1) * 50,
            "publish_date": f"2024-0{i+1}-01",
            "url": f"https://www.xiaohongshu.com/explore/note_{i}",
            "source": "dom",
            "comments": [
                {"id": f"c_{i}_1", "note_id": f"note_{i}", "content": "好棒", "likes": 10, "rank": 1}
            ]
        }
        for i in range(n)
    ]
    client.post("/api/notes", json={"notes": notes})


def test_list_notes_default(client):
    _seed(client)
    resp = client.get("/api/notes")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 3
    assert data["total"] == 3


def test_list_notes_filter_by_keyword(client):
    _seed(client, 4)
    resp = client.get("/api/notes?keyword=副业")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(n["keyword"] == "副业" for n in items)


def test_list_notes_sort_by_likes(client):
    _seed(client, 3)
    resp = client.get("/api/notes?sort=likes")
    items = resp.json()["items"]
    likes = [n["likes"] for n in items]
    assert likes == sorted(likes, reverse=True)


def test_list_notes_pagination(client):
    _seed(client, 5)
    resp = client.get("/api/notes?limit=2&offset=0")
    assert len(resp.json()["items"]) == 2
    resp2 = client.get("/api/notes?limit=2&offset=2")
    assert len(resp2.json()["items"]) == 2


def test_get_note_detail(client):
    _seed(client, 1)
    resp = client.get("/api/notes/note_0")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "note_0"
    assert data["content"] == "正文内容0，详细描述..."
    assert len(data["comments"]) == 1
    assert data["comments"][0]["rank"] == 1


def test_get_note_not_found(client):
    resp = client.get("/api/notes/nonexistent")
    assert resp.status_code == 404
