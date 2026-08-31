import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>MKQ物販集計</h1>
        <p>合言葉を入力してください。</p>
        <form action={login}>
          <input type="password" name="password" autoFocus placeholder="合言葉" />
          <button type="submit">入る</button>
          {error === "1" && <p className="error">合言葉が違います。</p>}
          {error === "config" && (
            <p className="error">サーバー側にAPP_PASSWORDが設定されていません。</p>
          )}
        </form>
      </div>
    </div>
  );
}
