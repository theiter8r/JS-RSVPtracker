import "./not-found.css";

/**
 * Shown for any URL that doesn't exist — and for /count with the wrong secret,
 * which calls notFound() so a guessed link reveals nothing.
 */
export default function NotFound() {
  return (
    <main className="nf">
      {/* A plain <img>: one static file, known dimensions, no optimizer needed. */}
      <img
        className="nf-img"
        src="/wrong-turn.jpg"
        width={768}
        height={768}
        alt="Meme: a figure from Wrong Turn standing in a forest, captioned “When you just gave someone direction and you just stand there and watch them taking a wrong turn”."
      />
      <p className="nf-code">404 · wrong turn</p>
      <p className="nf-text">This page doesn&apos;t exist. Check the link you were given.</p>
    </main>
  );
}
