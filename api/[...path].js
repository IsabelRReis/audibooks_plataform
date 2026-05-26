export const config = {
    api: {
        bodyParser: false,
    },
};

function buildTargetUrl(req, backendBaseUrl) {
    const normalizedBase = backendBaseUrl.endsWith("/") ? backendBaseUrl : `${backendBaseUrl}/`;
    const original = req.url || "/";
    const withoutApiPrefix = original.replace(/^\/api\/?/, "");
    return new URL(withoutApiPrefix, normalizedBase);
}

function buildForwardHeaders(req) {
    const headers = new Headers();
    const skipHeaders = new Set(["host", "connection", "content-length"]);

    for (const [key, value] of Object.entries(req.headers || {})) {
        if (!value) {
            continue;
        }

        const lowerKey = key.toLowerCase();
        if (skipHeaders.has(lowerKey)) {
            continue;
        }

        if (Array.isArray(value)) {
            headers.set(key, value.join(", "));
        } else {
            headers.set(key, value);
        }
    }

    return headers;
}

export default async function handler(req, res) {
    const backendBaseUrl = process.env.BACKEND_API_URL;

    if (!backendBaseUrl) {
        res.status(500).json({
            detail: "Variável BACKEND_API_URL não configurada no Vercel.",
        });
        return;
    }

    const targetUrl = buildTargetUrl(req, backendBaseUrl);
    const method = (req.method || "GET").toUpperCase();
    const canHaveBody = method !== "GET" && method !== "HEAD";

    try {
        const upstreamResponse = await fetch(targetUrl, {
            method,
            headers: buildForwardHeaders(req),
            body: canHaveBody ? req : undefined,
            redirect: "manual",
            duplex: canHaveBody ? "half" : undefined,
        });

        res.status(upstreamResponse.status);

        upstreamResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() === "transfer-encoding") {
                return;
            }
            res.setHeader(key, value);
        });

        const body = Buffer.from(await upstreamResponse.arrayBuffer());
        res.send(body);
    } catch (error) {
        res.status(502).json({
            detail: "Falha ao encaminhar requisição para o backend.",
            error: String(error),
        });
    }
}