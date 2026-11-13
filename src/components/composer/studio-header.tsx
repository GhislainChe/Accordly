import Image from "next/image";
import Link from "next/link";
export function StudioHeader() { return <header className="studio-header"><Link href="/app" aria-label="Accordly workspace"><Image src="/brand/accordly.png" width={932} height={244} alt="Accordly" unoptimized loading="eager" /></Link><span>Document studio</span><nav aria-label="Composer navigation"><Link href="/app">Back to workspace</Link></nav></header>; }
