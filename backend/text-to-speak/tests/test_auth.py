import json


def test_register_and_login(client):
    # Register
    payload = {"email": "testuser@example.com", "password": "strongpass", "name": "Test User"}
    resp = client.post("/auth/register", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data.get("redirect_to")

    # Login
    resp2 = client.post("/auth/login", json={"email": payload["email"], "password": payload["password"]})
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2.get("access_token")
    assert data2.get("profile") == "Usuário"
