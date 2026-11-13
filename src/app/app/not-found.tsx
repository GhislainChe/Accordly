import Link from "next/link";
export default function NotFound() { return <section className="panel empty"><h1>Agreement unavailable.</h1><p>It may not exist, or your account may not have access.</p><Link href="/app" className="button primary">Back to agreements</Link></section>; }
