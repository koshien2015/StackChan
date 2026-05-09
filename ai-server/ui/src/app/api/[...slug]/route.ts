import { type NextRequest, NextResponse } from "next/server";

// ビルド時ではなくリクエスト時に評価されるためDockerの環境変数が正しく使われる
const getApiUrl = () => process.env.API_URL ?? "http://localhost:3000";

async function proxy(req: NextRequest, slug: string[]): Promise<Response> {
  const url = `${getApiUrl()}/api/${slug.join("/")}`;
  const headers = new Headers(req.headers);
  headers.delete("host");

  return fetch(url, {
    method: req.method,
    headers,
    body:
      req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    // @ts-expect-error Node.js fetch requires duplex for streaming body
    duplex: "half",
  });
}

type Context = { params: Promise<{ slug: string[] }> };

export async function GET(req: NextRequest, { params }: Context) {
  const { slug } = await params;
  const res = await proxy(req, slug);
  return new NextResponse(res.body, { status: res.status, headers: res.headers });
}

export async function POST(req: NextRequest, { params }: Context) {
  const { slug } = await params;
  const res = await proxy(req, slug);
  return new NextResponse(res.body, { status: res.status, headers: res.headers });
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const { slug } = await params;
  const res = await proxy(req, slug);
  return new NextResponse(res.body, { status: res.status, headers: res.headers });
}
