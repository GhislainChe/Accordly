"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="panel empty"><h1>We couldn’t load this page.</h1><p>Check that your local database and Auth service are running, then try again.</p><button className="button primary" onClick={reset}>Try again</button></section>; }
