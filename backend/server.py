"""
Python wrapper that spawns the Node.js/Express API and proxies API traffic to it.
Business and payment logic run in the Node.js backend.
"""
import subprocess
import os
import sys
import atexit
import threading
import time
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Node process management
node_process = None
NODE_PORT = 8002  # Internal Node port


def start_node_server():
    global node_process
    node_app_path = os.path.join(os.path.dirname(__file__), 'node-app')

    env = os.environ.copy()
    env['PORT'] = str(NODE_PORT)

    node_process = subprocess.Popen(
        ['node', 'index.js'],
        cwd=node_app_path,
        stdout=sys.stdout,
        stderr=sys.stderr,
        env=env
    )

    time.sleep(2)
    print(f"Node.js server started on internal port {NODE_PORT}")


def stop_node_server():
    global node_process
    if node_process:
        node_process.terminate()
        node_process.wait()
        print("Node.js server stopped")


atexit.register(stop_node_server)
threading.Thread(target=start_node_server, daemon=True).start()


@app.get("/api/health")
async def health_check():
    """Health check endpoint for connectivity testing"""
    return {"ok": True, "service": "peekaboo-api"}


@app.post("/api/payments/create-checkout")
async def create_checkout(request: Request):
    """Delegate checkout creation to the Node.js payments providers."""
    try:
        auth_header = request.headers.get("authorization", "")
        payload = await request.json()

        async with httpx.AsyncClient() as client:
            node_resp = await client.post(
                f"http://localhost:{NODE_PORT}/api/payments/create-checkout",
                json=payload,
                headers={"Authorization": auth_header},
                timeout=30.0
            )

        if node_resp.status_code >= 400:
            raise HTTPException(status_code=node_resp.status_code, detail=node_resp.text)

        return node_resp.json()
    except HTTPException:
        raise
    except Exception as e:
        print(f"Checkout error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create checkout session")


@app.get("/api/payments/status/{session_id}")
async def get_checkout_status(request: Request, session_id: str):
    """Delegate checkout status checks to the Node.js payments providers."""
    try:
        auth_header = request.headers.get("authorization", "")

        async with httpx.AsyncClient() as client:
            node_resp = await client.get(
                f"http://localhost:{NODE_PORT}/api/payments/status/{session_id}",
                headers={"Authorization": auth_header},
                timeout=30.0
            )

        if node_resp.status_code >= 400:
            raise HTTPException(status_code=node_resp.status_code, detail=node_resp.text)

        return node_resp.json()
    except HTTPException:
        raise
    except Exception as e:
        print(f"Status check error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get checkout status")


# Proxy all other requests to Node
@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_to_node(request: Request, path: str):
    # Skip endpoints handled directly above
    if path.startswith("payments/create-checkout") or path.startswith("payments/status/"):
        raise HTTPException(status_code=404, detail="Not found")

    try:
        async with httpx.AsyncClient() as client:
            url = f"http://localhost:{NODE_PORT}/api/{path}"

            if request.query_params:
                url += f"?{request.query_params}"

            headers = dict(request.headers)
            headers.pop("host", None)

            body = await request.body()

            response = await client.request(
                method=request.method,
                url=url,
                headers=headers,
                content=body,
                timeout=30.0
            )

            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get("content-type")
            )
    except httpx.ConnectError:
        return Response(
            content='{"error": "Backend service unavailable"}',
            status_code=503,
            media_type="application/json"
        )
    except Exception as e:
        return Response(
            content=f'{{"error": "{str(e)}"}}',
            status_code=500,
            media_type="application/json"
        )


@app.get("/")
async def root():
    return {"message": "Peekaboo API Gateway"}
