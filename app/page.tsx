"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [tempName, setTempName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [myGroups, setMyGroups] = useState<any[]>([]);
  const [currentGroup, setCurrentGroup] = useState<any>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [inputKey, setInputKey] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [tags, setTags] = useState("");
  const [videoList, setVideoList] = useState<any[]>([]);
  const [unseenCounts, setUnseenCounts] = useState<Record<string, number>>({});
  // 監聽登入狀態變化
  useEffect(() => {
    // 1. 初始化檢查
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
        fetchMyGroups(session.user.id);
      }
    });

    // 2. 監聽後續狀態變化 (登入、登出)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
        fetchMyGroups(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 當切換群組時，把該群組的未讀數歸零
  useEffect(() => {
    if (currentGroup) {
      setUnseenCounts((prev) => ({ ...prev, [currentGroup.id]: 0 }));
    }
  }, [currentGroup?.id]);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) {
      setProfile(data);
      setTempName(data.display_name || "");
      setAvatarUrl(data.avatar_url || "");
    }
  };

  const uploadAvatar = async (event: any) => {
    try {
      setUploading(true);
      if (!event.target.files || event.target.files.length === 0) return;
      const file = event.target.files[0];
      const filePath = `${user.id}/${Math.random()}.${file.name.split(".").pop()}`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(filePath, file);
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);
      setAvatarUrl(publicUrl);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      display_name: tempName,
      avatar_url: avatarUrl,
      updated_at: new Date(),
    });
    if (!error) {
      await fetchProfile(user.id);
      setIsEditingProfile(false);
    }
  };

  const fetchMyGroups = async (userId: string) => {
    const { data, error } = await supabase
      .from("group_members")
      .select("groups (*)")
      .eq("user_id", userId);

    if (error) {
      console.error(error);
      return;
    }

    // 確保只取出 groups 的部分，並過濾掉可能的空值
    const groups = data?.map((item: any) => item.groups).filter(Boolean) || [];
    setMyGroups(groups);
  };

  const handleJoinGroup = async () => {
    // 1. 使用 .maybeSingle() 取代 .single()
    // .maybeSingle() 在找不到東西時會回傳 { data: null, error: null }，不會報錯 406
    const { data: group, error } = await supabase
      .from("groups")
      .select("*")
      .eq("access_key", inputKey)
      .maybeSingle();

    if (error) {
      console.error("Join error:", error);
      alert("查詢時發生錯誤，請稍後再試");
      return;
    }

    if (group) {
      // 2. 加入成員紀錄
      const { error: joinError } = await supabase
        .from("group_members")
        .upsert([{ user_id: user.id, group_id: group.id }], {
          onConflict: "user_id, group_id", // 確保重複加入時不會出錯
        });

      if (joinError) {
        alert("加入失敗：" + joinError.message);
        return;
      }

      // 3. 成功後的操作
      setCurrentGroup(group);
      fetchMyGroups(user.id);
      fetchVideos(group.id);
      setInputKey(""); // 清空輸入框
    } else {
      // 這裡現在能正確執行了，因為 maybeSingle 沒找到會回傳 null
      alert("金鑰無效，找不到該頻道！");
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return alert("請輸入群組名稱");
    const secretKey = crypto.randomUUID();

    const { data: group, error } = await supabase
      .from("groups")
      .insert([
        {
          group_name: newGroupName,
          access_key: secretKey,
          created_by: user.id,
        },
      ])
      .select()
      .single();

    if (error) {
      // 判斷是否為名稱重複錯誤 (PostgreSQL 錯誤碼 23505)
      if (error.code === "23505") {
        alert("這個群組名稱已經有人用過了，換一個吧！");
      } else {
        alert("建立失敗：" + error.message);
      }
      return;
    }

    setGeneratedKey(secretKey);
    fetchMyGroups(user.id);
  };

  const fetchVideos = async (groupId: string) => {
    const { data } = await supabase
      .from("videos")
      .select(
        "*, ratings(score, user_id, profiles:user_id(display_name, avatar_url))",
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });
    if (data) setVideoList(data);
  };

  const handleSubmitVideo = async () => {
    const videoId = videoUrl.includes("/shorts/")
      ? videoUrl.split("/shorts/")[1]?.split(/[?&]/)[0]
      : videoUrl.match(
          /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/,
        )?.[2];
    const embedUrl = videoId
      ? `https://www.youtube.com/embed/${videoId}${videoUrl.includes("/shorts/") ? "#shorts" : ""}`
      : null;
    if (!embedUrl) return alert("網址錯誤");
    if (videoList.some((v) => v.url === embedUrl)) return alert("重複了");
    await supabase.from("videos").insert([
      {
        url: embedUrl,
        group_id: currentGroup.id,
        created_by: user.id,
        title: tags,
      },
    ]);
    setVideoUrl("");
    setTags("");
    fetchVideos(currentGroup.id);
  };

  const handleRate = async (
    videoId: string,
    score: number,
    creatorId: string,
  ) => {
    if (user.id === creatorId) return alert("不能投自己");
    await supabase
      .from("ratings")
      .upsert(
        { video_id: videoId, user_id: user.id, score },
        { onConflict: "video_id, user_id" },
      );
    fetchVideos(currentGroup.id);
  };

  const getAvg = (ratings: any[]) => {
    if (!ratings || ratings.length === 0) return "未評";
    const avg = ratings.reduce((a, b) => a + b.score, 0) / ratings.length;
    return avg >= 3.5 ? "ㄅ" : avg >= 2.5 ? "ㄆ" : avg >= 1.5 ? "ㄇ" : "ㄈ";
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    // 雙重確認，避免手滑
    const confirmName = prompt(
      `確定要刪除「${groupName}」嗎？此動作無法復原。\n請輸入群組名稱以確認刪除：`,
    );

    if (confirmName !== groupName) {
      if (confirmName !== null) alert("名稱輸入錯誤，取消刪除。");
      return;
    }

    // 執行刪除 (由於之前 SQL 設有 ON DELETE CASCADE，相關影片與成員紀錄會自動刪除)
    const { error } = await supabase.from("groups").delete().eq("id", groupId);

    if (error) {
      alert("刪除失敗：" + error.message);
    } else {
      alert("群組已永久刪除");
      setCurrentGroup(null); // 回到大廳
      fetchMyGroups(user.id); // 重新整理側邊欄
    }
  };
  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      setUser(null);
      setProfile(null);
      setCurrentGroup(null);
      // 重點：直接刷回首頁或清空狀態
      window.location.reload();
    }
  };
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* 1. 手機版 & 電腦版通用頂部導覽列 */}
      {user && profile && (
        <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-gray-800 p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Hamburger Menu & Logo */}
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden cursor-pointer p-1"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <h1
              onClick={() => setCurrentGroup(null)}
              className="text-xl font-black italic text-yellow-500 tracking-tighter cursor-pointer"
            >
              SHIT-VIDEO
            </h1>
          </div>

          {/* 右側個人資訊與登出按鈕 */}
          <div className="flex items-center gap-4">
            {/* 個人頭像 */}
            <div
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => setIsEditingProfile(true)}
            >
              <div className="text-right hidden sm:block">
                <p className="text-xs font-black">{profile.display_name}</p>
                <p className="text-[10px] text-gray-500 uppercase">Edit</p>
              </div>
              <img
                src={
                  profile.avatar_url ||
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`
                }
                className="w-10 h-10 rounded-full border border-gray-700 object-cover"
              />
            </div>
            {/* 登出圖示按鈕 */}
            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-500 transition-colors cursor-pointer"
              title="登出"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </button>
          </div>
        </header>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 2. 抽屜式側邊欄 (側邊滑入) */}
        <aside
          className={`fixed inset-y-0 left-0 z-[60] w-64 bg-gray-900 border-r border-gray-800 p-6 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex justify-between items-center mb-8 md:hidden">
            <span className="font-black text-yellow-500">頻道列表</span>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="text-gray-500 cursor-pointer"
            >
              ✕
            </button>
          </div>
          <nav className="flex flex-col gap-2">
            <h2 className="text-[10px] text-gray-500 font-bold tracking-widest uppercase mb-2">
              我的頻道
            </h2>
            {myGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setCurrentGroup(g);
                  fetchVideos(g.id);
                  setIsSidebarOpen(false);
                  // ... 這裡如果有 setGeneratedKey("") 也保留
                }}
                className={`p-3 rounded-2xl text-left text-sm font-bold flex justify-between items-center transition ${
                  currentGroup?.id === g.id
                    ? "bg-yellow-500 text-black shadow-lg"
                    : "hover:bg-gray-800 text-gray-500"
                }`}
              >
                {/* 群組名稱 */}
                <span className="truncate mr-2"># {g.group_name}</span>

                {/* 💩 大便新消息提示 💩 */}
                {unseenCounts[g.id] > 0 && (
                  <div className="relative flex items-center justify-center flex-shrink-0 animate-pulse-slow">
                    {/* 大便 Emoji 本體 - 這裡調大一點 */}
                    <span className="text-xl">💩</span>

                    {/* 咖啡色數字 - 放在大便旁邊 */}
                    <span className="absolute -top-1 -right-1 bg-black/80 text-[#8B4513] text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border border-gray-800 min-w-[18px] text-center shadow-lg">
                      {unseenCounts[g.id]}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* 點擊背景關閉選單 */}
        {isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 z-[55] bg-black/60 md:hidden"
          ></div>
        )}

        {/* 3. 主畫面內容 */}
        <main className="flex-1 overflow-y-auto p-4 py-8">
          <div className="max-w-xl mx-auto">
            {!user ? (
              <div className="text-center mt-20">
                <button
                  onClick={() =>
                    supabase.auth.signInWithOAuth({ provider: "google" })
                  }
                  className="bg-white text-black px-12 py-4 rounded-full font-black text-lg cursor-pointer shadow-xl"
                >
                  Google Login
                </button>
              </div>
            ) : isEditingProfile || !profile ? (
              <div className="bg-gray-900 p-8 rounded-[3rem] border border-yellow-500 shadow-2xl text-center">
                <h2 className="text-2xl font-black mb-8">設定檔案</h2>
                <div className="relative w-24 h-24 mx-auto mb-8 group cursor-pointer">
                  <img
                    src={
                      avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`
                    }
                    className="w-full h-full rounded-full bg-black border-2 border-gray-800 object-cover"
                  />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition">
                    <span className="text-[10px] font-bold">
                      {uploading ? "傳送中" : "更換"}
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={uploadAvatar}
                      disabled={uploading}
                    />
                  </label>
                </div>
                <input
                  className="w-full bg-black p-5 rounded-2xl text-center border border-gray-800 mb-4 outline-none focus:border-yellow-500"
                  placeholder="你的暱稱"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                />
                <button
                  onClick={handleSaveProfile}
                  className="w-full bg-yellow-500 text-black font-black p-5 rounded-2xl cursor-pointer"
                >
                  儲存
                </button>
                {profile && (
                  <button
                    onClick={() => setIsEditingProfile(false)}
                    className="block w-full mt-4 text-gray-500 text-sm"
                  >
                    取消
                  </button>
                )}
              </div>
            ) : !currentGroup ? (
              <div className="space-y-8 mt-10 text-center">
                <div className="bg-gray-900 p-8 rounded-[3rem] border border-gray-800 shadow-xl">
                  <h2 className="font-bold mb-6 italic text-xl">🔑 加入群組</h2>
                  <input
                    className="w-full bg-black p-5 rounded-2xl mb-4 text-center text-sm outline-none focus:ring-1 ring-yellow-500"
                    placeholder="UUID 金鑰"
                    value={inputKey}
                    onChange={(e) => setInputKey(e.target.value)}
                  />
                  <button
                    onClick={handleJoinGroup}
                    className="w-full bg-yellow-500 text-black font-black p-5 rounded-2xl cursor-pointer"
                  >
                    進入
                  </button>
                </div>
                <input
                  className="bg-transparent border-b border-gray-800 p-3 text-center w-full mb-2 text-xl outline-none text-yellow-500"
                  placeholder="新頻道名稱"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
                <button
                  onClick={handleCreateGroup}
                  className="text-sm text-gray-500 underline font-bold cursor-pointer"
                >
                  建立頻道
                </button>
                {/* 建立頻道的按鈕下方 */}
                {generatedKey && (
                  <div className="mt-8 p-6 bg-gray-900 rounded-[2rem] border-2 border-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.3)] mx-auto w-full max-w-sm">
                    <p className="text-xs text-gray-400 mb-3 uppercase tracking-widest font-black text-center">
                      🎉 頻道建立成功！
                    </p>

                    {/* 金鑰主體：text-2xl 確保大字，font-mono 確保整齊 */}
                    <div className="bg-black p-4 rounded-xl text-yellow-400 text-2xl font-mono break-all text-center border border-gray-800 mb-4 select-all shadow-inner">
                      {generatedKey}
                    </div>

                    {/* 滿版大按鈕方便大拇指點擊 */}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedKey);
                        alert("金鑰已成功複製到剪貼簿。");
                      }}
                      className="w-full bg-yellow-500 text-black py-4 rounded-xl font-black text-lg hover:bg-yellow-400 active:scale-95 transition-all cursor-pointer shadow-lg"
                    >
                      複製金鑰
                    </button>

                    <p className="text-[10px] text-gray-600 mt-4 text-center leading-relaxed">
                      提示：您可以點擊金鑰直接選取，
                      <br />
                      或使用上方按鈕直接複製。
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-10">
                <div className="flex justify-between items-center px-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-3xl font-black italic">
                      {currentGroup.group_name}
                    </h2>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(currentGroup.access_key);
                        alert("複製金鑰成功！");
                      }}
                      className="p-2 bg-gray-900 rounded-xl text-yellow-500 border border-gray-800 cursor-pointer shadow-lg"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                      </svg>
                    </button>
                  </div>
                  <div className="flex gap-4 items-center">
                    {/* 關鍵判斷：只有創建者才看得到刪除按鈕 */}
                    {user.id === currentGroup.created_by && (
                      <button
                        onClick={() =>
                          handleDeleteGroup(
                            currentGroup.id,
                            currentGroup.group_name,
                          )
                        }
                        className="text-[10px] text-red-500 font-bold border border-red-500/30 hover:bg-red-500 hover:text-white px-2 py-1 rounded transition cursor-pointer"
                      >
                        刪除群組
                      </button>
                    )}

                    <button
                      onClick={() => setCurrentGroup(null)}
                      className="text-xs text-gray-600 hover:text-white cursor-pointer"
                    >
                      離開頻道
                    </button>
                  </div>
                </div>

                <div className="bg-gray-900 p-6 rounded-[2.5rem] border border-gray-800 shadow-xl">
                  <input
                    className="w-full bg-black p-4 rounded-2xl mb-3 text-sm outline-none"
                    placeholder="YouTube 連結"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                  />
                  <input
                    className="w-full bg-black p-4 rounded-2xl mb-4 text-sm outline-none"
                    placeholder="標籤 (例如: 狠角色)"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                  <button
                    onClick={handleSubmitVideo}
                    className="w-full bg-blue-600 py-4 rounded-2xl font-black shadow-lg shadow-blue-900/40 cursor-pointer"
                  >
                    分享影片
                  </button>
                </div>

                <div className="space-y-16">
                  {videoList.map((vid) => {
                    const isShorts = vid.url.includes("#shorts");
                    return (
                      <div
                        key={vid.id}
                        className="bg-gray-900 rounded-[3rem] overflow-hidden border border-gray-800 shadow-2xl"
                      >
                        <div
                          className="mx-auto bg-black"
                          style={{
                            width: "100%",
                            maxWidth: isShorts ? "360px" : "100%",
                            aspectRatio: isShorts ? "9/16" : "16/9",
                          }}
                        >
                          <iframe
                            width="100%"
                            height="100%"
                            src={vid.url}
                            frameBorder="0"
                            allowFullScreen
                          ></iframe>
                        </div>
                        <div className="p-8">
                          <div className="flex justify-between items-center mb-6">
                            <div className="flex gap-2 overflow-x-auto no-scrollbar">
                              {vid.title?.split(",").map(
                                (t: any) =>
                                  t.trim() && (
                                    <span
                                      key={t}
                                      className="bg-gray-800 text-blue-400 px-4 py-1.5 rounded-full text-[11px] font-black"
                                    >
                                      #{t}
                                    </span>
                                  ),
                              )}
                            </div>
                            {user.id === vid.created_by && (
                              <button
                                onClick={async () => {
                                  if (confirm("刪除？")) {
                                    await supabase
                                      .from("videos")
                                      .delete()
                                      .eq("id", vid.id);
                                    setVideoList(
                                      videoList.filter((v) => v.id !== vid.id),
                                    );
                                  }
                                }}
                                className="text-gray-700 hover:text-red-500 cursor-pointer"
                              >
                                <svg
                                  width="18"
                                  height="18"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                </svg>
                              </button>
                            )}
                          </div>
                          <div className="flex items-center justify-between pt-8 border-t border-gray-800/50">
                            <div className="flex flex-col">
                              <span className="text-2xl text-gray-600 font-bold uppercase">
                                評價
                              </span>
                              <span className="text-3xl font-black text-yellow-500 leading-none mt-1">
                                {getAvg(vid.ratings)}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              {[
                                { l: "ㄅ", s: 4 },
                                { l: "ㄆ", s: 3 },
                                { l: "ㄇ", s: 2 },
                                { l: "ㄈ", s: 1 },
                              ].map((i) => (
                                <button
                                  key={i.l}
                                  onClick={() =>
                                    handleRate(vid.id, i.s, vid.created_by)
                                  }
                                  disabled={user.id === vid.created_by}
                                  className={`w-11 h-11 rounded-2xl border-2 font-black text-lg transition-all cursor-pointer ${user.id === vid.created_by ? "border-gray-800 text-gray-800 opacity-20" : "border-gray-800 hover:bg-yellow-500 hover:text-black"}`}
                                >
                                  {i.l}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="mt-6 flex flex-wrap gap-2">
                            {vid.ratings?.map((r: any, idx: number) => (
                              <div
                                key={idx}
                                className="bg-gray-800/30 px-3 py-1.5 rounded-xl text-[10px] border border-gray-800/50 flex items-center gap-2"
                              >
                                <img
                                  src={
                                    r.profiles?.avatar_url ||
                                    `https://api.dicebear.com/7.x/bottts/svg?seed=${r.user_id}`
                                  }
                                  className="w-4 h-4 rounded-full"
                                />
                                <span className="text-gray-400 font-bold">
                                  {r.profiles?.display_name}:
                                </span>
                                <span className="font-black text-white">
                                  {r.score === 4
                                    ? "ㄅ"
                                    : r.score === 3
                                      ? "ㄆ"
                                      : r.score === 2
                                        ? "ㄇ"
                                        : "ㄈ"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
