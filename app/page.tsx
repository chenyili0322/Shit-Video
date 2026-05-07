"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// --- Supabase 初始化 ---
const supabaseUrl = "https://ubjrmvwydsmecurdxjjk.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVianJtdnd5ZHNtZWN1cmR4amprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzEyNTksImV4cCI6MjA5MzcwNzI1OX0.FJyNf0Cf6OS-bVDkKcodm8-DK9jXaA7a0re6QqMOAZA";
const supabase = createClient(supabaseUrl, supabaseKey);

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  // 狀態初始化 (確保皆為空字串避免 uncontrolled 警告)
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

  // 1. 初始化與身份驗證
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) {
        fetchProfile(user.id);
        fetchMyGroups(user.id);
      }
    });
  }, []);

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

  // 2. 個人檔案與頭像上傳
  const uploadAvatar = async (event: any) => {
    try {
      setUploading(true);
      if (!event.target.files || event.target.files.length === 0) return;
      const file = event.target.files[0];
      const fileExt = file.name.split(".").pop();
      const filePath = `${user.id}/${Math.random()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);
      setAvatarUrl(publicUrl);
    } catch (error: any) {
      alert("上傳失敗: " + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!tempName.trim()) return alert("暱稱不能為空");
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      display_name: tempName,
      avatar_url: avatarUrl,
      updated_at: new Date(),
    });
    if (!error) {
      await fetchProfile(user.id);
      setIsEditingProfile(false);
      alert("個人檔案已更新");
    }
  };

  // 3. 群組邏輯
  const fetchMyGroups = async (userId: string) => {
    const { data } = await supabase
      .from("group_members")
      .select("groups (*)")
      .eq("user_id", userId);
    if (data) setMyGroups(data.map((item: any) => item.groups));
  };

  const handleJoinGroup = async () => {
    if (!inputKey.trim()) return alert("請輸入金鑰");
    const { data: group } = await supabase
      .from("groups")
      .select("*")
      .eq("access_key", inputKey)
      .single();
    if (group) {
      await supabase
        .from("group_members")
        .upsert([{ user_id: user.id, group_id: group.id }]);
      setCurrentGroup(group);
      fetchMyGroups(user.id);
      fetchVideos(group.id);
    } else alert("金鑰無效");
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return alert("請輸入群組名稱");
    const secretKey = crypto.randomUUID();
    const { data: group } = await supabase
      .from("groups")
      .insert([{ group_name: newGroupName, access_key: secretKey }])
      .select()
      .single();
    if (group && user) {
      await supabase
        .from("group_members")
        .insert([{ user_id: user.id, group_id: group.id }]);
      setGeneratedKey(secretKey);
      fetchMyGroups(user.id);
    }
  };

  // 4. 影片牆、評分與刪除
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

  const getEmbedUrl = (url: string) => {
    if (url.includes("/shorts/")) {
      const videoId = url.split("/shorts/")[1]?.split(/[?&]/)[0];
      return videoId ? `https://www.youtube.com/embed/${videoId}#shorts` : null;
    }
    const match = url.match(
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/,
    );
    return match ? `https://www.youtube.com/embed/${match[2]}` : null;
  };

  const handleSubmitVideo = async () => {
    const embedUrl = getEmbedUrl(videoUrl);
    if (!embedUrl || !currentGroup) return alert("網址無效或尚未進入頻道");
    if (videoList.some((vid) => vid.url === embedUrl))
      return alert("這部片有人分享過囉！");

    const { error } = await supabase
      .from("videos")
      .insert([
        {
          url: embedUrl,
          group_id: currentGroup.id,
          created_by: user.id,
          title: tags.trim() || "無標籤",
        },
      ]);
    if (error) alert("分享失敗：" + error.message);
    else {
      setVideoUrl("");
      setTags("");
      fetchVideos(currentGroup.id);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    if (!confirm("確定要刪除這支幹片嗎？")) return;
    const { error } = await supabase.from("videos").delete().eq("id", id);
    if (!error) setVideoList(videoList.filter((v) => v.id !== id));
  };

  const handleRate = async (
    videoId: string,
    score: number,
    creatorId: string,
  ) => {
    if (user.id === creatorId) return alert("不能評分自己的影片");
    const { error } = await supabase
      .from("ratings")
      .upsert(
        { video_id: videoId, user_id: user.id, score },
        { onConflict: "video_id, user_id" },
      );
    if (!error) fetchVideos(currentGroup.id);
  };

  const getAvg = (ratings: any[]) => {
    if (!ratings || ratings.length === 0) return "未評";
    const avg = ratings.reduce((a, b) => a + b.score, 0) / ratings.length;
    return avg >= 3.5 ? "ㄅ" : avg >= 2.5 ? "ㄆ" : avg >= 1.5 ? "ㄇ" : "ㄈ";
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("金鑰已複製到剪貼簿！");
  };

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* 側邊欄 (電腦版顯示) */}
      {user && profile && !isEditingProfile && (
        <aside className="w-64 border-r border-gray-800 p-6 hidden md:flex flex-col gap-8">
          <div className="flex items-center gap-3">
            <img
              src={
                profile.avatar_url ||
                `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`
              }
              className="w-10 h-10 rounded-full border border-gray-700 object-cover"
            />
            <div className="overflow-hidden">
              <p className="text-sm font-black truncate">
                {profile.display_name}
              </p>
              <button
                onClick={() => setIsEditingProfile(true)}
                className="text-[10px] text-yellow-500 font-bold hover:underline cursor-pointer"
              >
                編輯檔案
              </button>
            </div>
          </div>
          <nav className="flex flex-col gap-4">
            <h2 className="text-[10px] text-gray-500 font-bold tracking-widest uppercase">
              我的頻道
            </h2>
            {myGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setCurrentGroup(g);
                  fetchVideos(g.id);
                }}
                className={`p-3 rounded-2xl text-left text-sm font-bold transition cursor-pointer ${currentGroup?.id === g.id ? "bg-yellow-500 text-black" : "hover:bg-gray-900 text-gray-500"}`}
              >
                # {g.group_name}
              </button>
            ))}
          </nav>
        </aside>
      )}

      {/* 主畫面 */}
      <div className="flex-1 overflow-y-auto">
        <main className="max-w-xl mx-auto p-4 py-12">
          {!user ? (
            <div className="text-center mt-32">
              <button
                onClick={() =>
                  supabase.auth.signInWithOAuth({
                    provider: "google",
                    options: { redirectTo: window.location.origin },
                  })
                }
                className="bg-white text-black px-12 py-4 rounded-full font-black text-lg shadow-xl cursor-pointer"
              >
                Google Login
              </button>
            </div>
          ) : isEditingProfile || !profile ? (
            <div className="bg-gray-900 p-8 rounded-[3rem] border border-yellow-500 shadow-2xl text-center">
              <h2 className="text-2xl font-black mb-8">個人檔案設定</h2>
              <div className="flex flex-col items-center mb-8">
                <div className="relative group cursor-pointer">
                  <img
                    src={
                      avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`
                    }
                    className="w-24 h-24 rounded-full bg-black border-2 border-gray-800 object-cover"
                  />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition">
                    <span className="text-[10px] font-bold">
                      {uploading ? "上傳中..." : "更換頭像"}
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={uploadAvatar}
                      disabled={uploading}
                    />
                  </label>
                </div>
              </div>
              <input
                className="w-full bg-black p-5 rounded-2xl text-center border border-gray-800 mb-4 outline-none focus:border-yellow-500"
                placeholder="你的暱稱"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
              />
              <button
                onClick={handleSaveProfile}
                className="w-full bg-yellow-500 text-black font-black p-5 rounded-2xl text-lg mb-4 cursor-pointer"
              >
                儲存設定
              </button>
              {profile && (
                <button
                  onClick={() => setIsEditingProfile(false)}
                  className="text-gray-500 text-sm cursor-pointer"
                >
                  取消
                </button>
              )}
            </div>
          ) : !currentGroup ? (
            <div className="space-y-12">
              <div className="bg-gray-900 p-8 rounded-[3rem] shadow-2xl border border-gray-800">
                <h2 className="text-center font-bold mb-8 italic text-xl">
                  🔑 進入現有群組
                </h2>
                <input
                  className="w-full bg-black p-5 rounded-2xl mb-4 text-center text-sm outline-none focus:ring-1 ring-yellow-500"
                  placeholder="貼上 UUID 金鑰"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                />
                <button
                  onClick={handleJoinGroup}
                  className="w-full bg-yellow-500 text-black font-black p-5 rounded-2xl shadow-lg cursor-pointer"
                >
                  進入群組
                </button>
              </div>
              <div className="text-center space-y-4">
                <input
                  className="bg-transparent border-b border-gray-800 p-3 text-center w-full mb-2 text-xl outline-none font-black text-yellow-500"
                  placeholder="新群組名稱"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
                <button
                  onClick={handleCreateGroup}
                  className="text-sm text-gray-500 underline font-bold tracking-widest uppercase cursor-pointer hover:text-white"
                >
                  建立新頻道
                </button>
                {generatedKey && (
                  <div className="mt-4 p-4 bg-gray-900 rounded-2xl text-yellow-500 text-[10px] break-all font-mono border border-yellow-500/20">
                    {generatedKey}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-10">
              {/* 手機版頂部：導覽選單與個人檔案 */}
              <div className="md:hidden flex items-center justify-between mb-8 bg-gray-900/50 p-4 rounded-3xl border border-gray-800">
                <div className="flex items-center gap-3">
                  <img
                    src={
                      profile.avatar_url ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`
                    }
                    className="w-10 h-10 rounded-full border border-gray-700 cursor-pointer"
                    onClick={() => setIsEditingProfile(true)}
                  />
                  <select
                    className="bg-transparent font-black text-sm outline-none cursor-pointer text-yellow-500"
                    value={currentGroup.id}
                    onChange={(e) => {
                      const selected = myGroups.find(
                        (g) => g.id === e.target.value,
                      );
                      if (selected) {
                        setCurrentGroup(selected);
                        fetchVideos(selected.id);
                      }
                    }}
                  >
                    {myGroups.map((g) => (
                      <option
                        key={g.id}
                        value={g.id}
                        className="bg-black text-white"
                      >
                        # {g.group_name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setCurrentGroup(null)}
                  className="text-[10px] font-bold text-gray-500 uppercase border border-gray-800 px-3 py-1 rounded-full"
                >
                  返回
                </button>
              </div>

              {/* 頻道標題與分享 */}
              <div className="flex justify-between items-end px-2">
                <div>
                  <p className="text-[10px] text-gray-600 font-bold uppercase mb-1">
                    正在觀看頻道
                  </p>
                  <div className="flex items-center gap-3">
                    <h2 className="text-4xl font-black italic">
                      {currentGroup.group_name}
                    </h2>
                    <button
                      onClick={() => copyToClipboard(currentGroup.access_key)}
                      className="p-2 bg-gray-900 rounded-xl hover:bg-gray-800 text-yellow-500 transition-all border border-gray-800 cursor-pointer shadow-lg"
                      title="複製金鑰"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                      </svg>
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => setCurrentGroup(null)}
                  className="hidden md:block text-xs text-gray-600 hover:text-white transition cursor-pointer"
                >
                  切換頻道
                </button>
              </div>

              {/* 分享區塊 */}
              <div className="bg-gray-900 p-6 rounded-[2.5rem] border border-gray-800 shadow-xl">
                <input
                  className="w-full bg-black p-4 rounded-2xl mb-3 text-sm outline-none focus:ring-1 ring-blue-500"
                  placeholder="貼上 YouTube / Shorts 連結"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                />
                <input
                  className="w-full bg-black p-4 rounded-2xl mb-4 text-sm outline-none focus:ring-1 ring-blue-500"
                  placeholder="標籤 (例如: 狠角色, 搞笑)"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
                <button
                  onClick={handleSubmitVideo}
                  className="w-full bg-blue-600 py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-900/40 cursor-pointer hover:bg-blue-500 transition"
                >
                  分享影片
                </button>
              </div>

              {/* 影片牆 */}
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
                        <div className="flex justify-between items-start mb-6">
                          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                            {vid.title?.split(",").map(
                              (t: any) =>
                                t.trim() && (
                                  <span
                                    key={t}
                                    className="bg-gray-800 text-blue-400 px-4 py-1.5 rounded-full text-[11px] font-black whitespace-nowrap"
                                  >
                                    #{t}
                                  </span>
                                ),
                            )}
                          </div>
                          {user.id === vid.created_by && (
                            <button
                              onClick={() => handleDeleteVideo(vid.id)}
                              className="text-gray-700 hover:text-red-500 transition-colors cursor-pointer ml-4"
                            >
                              <svg
                                width="20"
                                height="20"
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
                            <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">
                              平均評價
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
                                className={`w-12 h-12 rounded-2xl border-2 font-black text-xl transition-all cursor-pointer ${user.id === vid.created_by ? "border-gray-800 text-gray-800 opacity-20 cursor-not-allowed" : "border-gray-800 hover:bg-yellow-500 hover:text-black hover:border-yellow-500"}`}
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
                                className="w-4 h-4 rounded-full object-cover"
                              />
                              <span className="text-gray-400 font-bold">
                                {r.profiles?.display_name || "網友"}:
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
        </main>
      </div>
    </div>
  );
}
