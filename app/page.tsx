import { Suspense } from "react";
import { connection } from "next/server";
import { needs } from "@/lib/tcgapi";
import Scanner from "./scanner";

// Read the environment when the page is requested, not when the app is built.
async function App() {
  await connection();
  return <Scanner needs={needs()} />;
}

export default function Home() {
  return (
    <main>
      <header>
        <h1>Card scanner</h1>
        <span className="dim">
          example for <a href="https://tcgapi.dev/use-cases/card-scanner/">TCG API</a>
        </span>
      </header>
      <Suspense>
        <App />
      </Suspense>
    </main>
  );
}
