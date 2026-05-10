// app/page.tsx
import { Suspense } from "react";
import HomeContent from "./HomeContent";

export default function Page() {
  return (
    <main className="h-screen bg-black">
      <Suspense fallback={
        <div className="h-screen bg-black text-white flex items-center justify-center font-black italic text-2xl animate-pulse">
          SHIT-VIDEO LOADING... 💩
        </div>
      }>
        <HomeContent />
      </Suspense>
    </main>
  );
}