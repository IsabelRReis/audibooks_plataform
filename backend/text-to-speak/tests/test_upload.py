import io
import app_main


def test_admin_multi_upload(client, fake_db):
    # create admin user directly in fake DB
    admin_email = "admin@example.com"
    admin_doc = {
        "email": admin_email,
        "password_hash": app_main._hash_password("adminpass"),
        "role": "admin",
        "profile": "Admin",
        "name": "Administrator",
        "created_at": None,
    }
    # insert admin
    fake_db.create_user(admin_doc)

    # login admin
    resp = client.post("/auth/login", json={"email": admin_email, "password": "adminpass"})
    assert resp.status_code == 200
    token = resp.json().get("access_token")
    assert token

    # perform multi-upload (files param 'files')
    files = [
        ("files", ("a.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")),
        ("files", ("b.pdf", io.BytesIO(b"%PDF-1.4 fake2"), "application/pdf")),
    ]
    headers = {"Authorization": f"Bearer {token}"}
    resp2 = client.post("/admin/uploads", files=files, headers=headers)
    assert resp2.status_code == 200
    data = resp2.json()
    assert data.get("uploaded_count") == 2
