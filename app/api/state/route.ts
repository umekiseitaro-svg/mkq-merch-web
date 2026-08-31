import { getState, setState } from "@/lib/store";
import { verifySession } from "@/lib/session";
import { isAppState } from "@/lib/types";

export async function GET() {
  if (!(await verifySession())) {
    return Response.json({ error: "認証が必要です。" }, { status: 401 });
  }
  const state = await getState();
  return Response.json({ state });
}

export async function PUT(request: Request) {
  if (!(await verifySession())) {
    return Response.json({ error: "認証が必要です。" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const state = body && typeof body === "object" ? (body as { state?: unknown }).state : null;
  if (!isAppState(state)) {
    return Response.json({ error: "不正なデータです。" }, { status: 400 });
  }
  await setState(state);
  return Response.json({ ok: true });
}
