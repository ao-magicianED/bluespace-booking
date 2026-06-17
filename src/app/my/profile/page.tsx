"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserAuth } from "@/lib/auth-browser";

/** 会員情報の編集（基本情報・パスワード変更・メールアドレス変更） */
export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");

  // --- 基本情報 ---
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [customerType, setCustomerType] = useState<"individual" | "corporate">("individual");
  const [companyName, setCompanyName] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);

  // --- パスワード変更 ---
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  // --- メールアドレス変更 ---
  const [emailStep, setEmailStep] = useState<"form" | "verify">("form");
  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [needsBoth, setNeedsBoth] = useState(true);
  const [codeNew, setCodeNew] = useState("");
  const [codeCurrent, setCodeCurrent] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getBrowserAuth();
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        window.location.href = "/login";
        return;
      }
      const meta = data.user.user_metadata ?? {};
      setName((meta.full_name as string) ?? "");
      setPhone((meta.phone as string) ?? "");
      setCustomerType(meta.customer_type === "corporate" ? "corporate" : "individual");
      setCompanyName((meta.company_name as string) ?? "");
      setEmail(data.user.email ?? "");
      setLoading(false);
    })();
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (customerType === "corporate" && !companyName.trim()) {
      setProfileError("会社名を入力してください");
      return;
    }
    setProfileBusy(true);
    setProfileError("");
    setProfileSaved(false);
    const supabase = getBrowserAuth();
    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: name.trim(),
        phone: phone.trim(),
        customer_type: customerType,
        company_name: customerType === "corporate" ? companyName.trim() : "",
      },
    });
    if (error) setProfileError("保存に失敗しました: " + error.message);
    else setProfileSaved(true);
    setProfileBusy(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw.length < 8) {
      setPwError("新しいパスワードは8文字以上にしてください");
      return;
    }
    if (newPw !== newPw2) {
      setPwError("確認用パスワードが一致しません");
      return;
    }
    setPwBusy(true);
    setPwError("");
    setPwSaved(false);
    const supabase = getBrowserAuth();
    // 本人確認: 現在のパスワードでサインインできるか
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPw,
    });
    if (signInError) {
      setPwError("現在のパスワードが正しくありません");
      setPwBusy(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) {
      setPwError("変更に失敗しました: " + error.message);
    } else {
      setPwSaved(true);
      setCurrentPw("");
      setNewPw("");
      setNewPw2("");
    }
    setPwBusy(false);
  }

  async function requestEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailBusy(true);
    setEmailError("");
    try {
      const res = await fetch("/api/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, password: emailPw }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEmailError(json.error ?? "送信に失敗しました");
        setEmailBusy(false);
        return;
      }
      setNeedsBoth(Boolean(json.needsBoth));
      setEmailStep("verify");
    } catch {
      setEmailError("通信エラーが発生しました。もう一度お試しください");
    }
    setEmailBusy(false);
  }

  async function verifyEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailBusy(true);
    setEmailError("");
    const supabase = getBrowserAuth();
    if (needsBoth) {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: codeCurrent.trim(),
        type: "email_change",
      });
      if (error) {
        setEmailError("現在のアドレス宛のコードが正しくないか、期限切れです");
        setEmailBusy(false);
        return;
      }
    }
    const { error } = await supabase.auth.verifyOtp({
      email: newEmail.trim().toLowerCase(),
      token: codeNew.trim(),
      type: "email_change",
    });
    if (error) {
      setEmailError("新しいアドレス宛のコードが正しくないか、期限切れです");
      setEmailBusy(false);
      return;
    }
    // 反映確認
    const { data } = await supabase.auth.getUser();
    const updated = data.user?.email ?? "";
    setEmail(updated);
    setEmailSaved(true);
    setEmailStep("form");
    setNewEmail("");
    setEmailPw("");
    setCodeNew("");
    setCodeCurrent("");
    setEmailBusy(false);
  }

  if (loading) {
    return (
      <div className="auth-box">
        <p>読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="auth-box">
      <h1>会員情報の変更</h1>

      {/* ───── 基本情報 ───── */}
      <form onSubmit={saveProfile}>
        <div className="customer-type-row">
          <label className="option-item">
            <input
              type="radio"
              name="profileCustomerType"
              checked={customerType === "individual"}
              onChange={() => setCustomerType("individual")}
            />
            個人
          </label>
          <label className="option-item">
            <input
              type="radio"
              name="profileCustomerType"
              checked={customerType === "corporate"}
              onChange={() => setCustomerType("corporate")}
            />
            法人
          </label>
        </div>
        {customerType === "corporate" && (
          <div className="form-field">
            <label>会社名</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="株式会社〇〇"
              required
            />
          </div>
        )}
        <div className="form-field">
          <label>お名前{customerType === "corporate" ? "（ご担当者）" : ""}</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-field">
          <label>電話番号</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        {profileError && <div className="notice error">{profileError}</div>}
        {profileSaved && (
          <div className="notice success">保存しました。次回の予約から自動入力されます。</div>
        )}
        <button className="submit-btn" disabled={profileBusy}>
          {profileBusy ? "保存中..." : "基本情報を保存する"}
        </button>
      </form>

      {/* ───── パスワード変更 ───── */}
      <hr className="profile-divider" />
      <h2>パスワードの変更</h2>
      <form onSubmit={changePassword}>
        <div className="form-field">
          <label>現在のパスワード</label>
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            required
          />
          <p className="policy">
            現在のパスワードが分からない場合は{" "}
            <Link href="/reset-password">パスワードの再設定</Link> をご利用ください。
          </p>
        </div>
        <div className="form-field">
          <label>新しいパスワード（8文字以上）</label>
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div className="form-field">
          <label>新しいパスワード（確認）</label>
          <input
            type="password"
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
            required
            minLength={8}
          />
        </div>
        {pwError && <div className="notice error">{pwError}</div>}
        {pwSaved && <div className="notice success">パスワードを変更しました。</div>}
        <button className="submit-btn" disabled={pwBusy}>
          {pwBusy ? "変更中..." : "パスワードを変更する"}
        </button>
      </form>

      {/* ───── メールアドレス変更 ───── */}
      <hr className="profile-divider" />
      <h2>メールアドレスの変更</h2>
      <p className="policy">現在のメールアドレス: {email}</p>
      {emailSaved && (
        <div className="notice success">メールアドレスを変更しました（{email}）。</div>
      )}
      {emailStep === "form" ? (
        <form onSubmit={requestEmailChange}>
          <div className="form-field">
            <label>新しいメールアドレス</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label>現在のパスワード（本人確認）</label>
            <input
              type="password"
              value={emailPw}
              onChange={(e) => setEmailPw(e.target.value)}
              required
            />
          </div>
          {emailError && <div className="notice error">{emailError}</div>}
          <button className="submit-btn" disabled={emailBusy}>
            {emailBusy ? "送信中..." : "確認コードを送る"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyEmailChange}>
          <p className="policy">
            確認コードを{needsBoth ? "現在と新しい両方のアドレス" : "新しいアドレス"}
            に送りました。{needsBoth ? "両方のコードを" : "コードを"}入力してください。
          </p>
          {needsBoth && (
            <div className="form-field">
              <label>現在のメールアドレス（{email}）宛のコード</label>
              <input
                type="text"
                inputMode="numeric"
                value={codeCurrent}
                onChange={(e) => setCodeCurrent(e.target.value)}
                placeholder="123456"
                required
              />
            </div>
          )}
          <div className="form-field">
            <label>新しいメールアドレス（{newEmail}）宛のコード</label>
            <input
              type="text"
              inputMode="numeric"
              value={codeNew}
              onChange={(e) => setCodeNew(e.target.value)}
              placeholder="123456"
              required
            />
          </div>
          {emailError && <div className="notice error">{emailError}</div>}
          <button className="submit-btn" disabled={emailBusy}>
            {emailBusy ? "確認中..." : "メールアドレスを変更する"}
          </button>
          <p>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setEmailStep("form");
                setEmailError("");
              }}
            >
              ← やり直す
            </a>
          </p>
        </form>
      )}

      <hr className="profile-divider" />
      <p>
        <Link href="/my">← マイページへ戻る</Link>
      </p>
    </div>
  );
}
