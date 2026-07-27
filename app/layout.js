import { Inter_Tight } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/smooth-scroll";

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
});

export const metadata = {
  metadataBase: new URL("https://justclarify.xyz"),
  title: "JustClarify",
  description: "JustClarify – clear, structured answers.",
  icons: {
    icon: [{ url: "/diamond.svg", type: "image/svg+xml" }],
    shortcut: "/diamond.svg",
    apple: "/diamond.svg",
  },
  openGraph: {
    title: "JustClarify",
    description: "JustClarify – clear, structured answers.",
    type: "website",
    images: [
      {
        url: "/Images/OgImage.webp",
        width: 1200,
        height: 630,
        alt: "JustClarify preview image",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "JustClarify",
    description: "JustClarify – clear, structured answers.",
    images: ["/Images/OgImage.webp"],
  },
};

// Default status-bar colour; the brand script overrides it per load with the
// same random accent it paints the site with.
export const viewport = {
  themeColor: "#a75c53",
};

// One dull, random OKLCH accent per page load, shared by every component — set
// on :root as --accent, mirrored to Safari's status bar (theme-color) and to a
// diamond favicon drawn in that colour. Runs before paint so there's no flash
// and Safari reads the right colour on load (it only reads theme-color once).
const BRAND_SCRIPT = `(function(){try{
var l=+(0.55+Math.random()*0.11).toFixed(3),c=+(0.05+Math.random()*0.06).toFixed(3),h=Math.floor(Math.random()*360);
var R=document.documentElement;
R.style.setProperty('--accent','oklch('+l+' '+c+' '+h+')');
R.style.setProperty('--accent-soft','oklch('+l+' '+c+' '+h+' / .12)');
function o2r(l,c,h){var r=h*Math.PI/180,a=c*Math.cos(r),b=c*Math.sin(r),
x=l+0.3963377774*a+0.2158037573*b,y=l-0.1055613458*a-0.0638541728*b,z=l-0.0894841775*a-1.291485548*b;
x=x*x*x;y=y*y*y;z=z*z*z;
var P=4.0767416621*x-3.3077115913*y+0.2309699292*z,Q=-1.2684380046*x+2.6097574011*y-0.3413193965*z,S=-0.0041960863*x-0.7034186147*y+1.707614701*z;
function g(v){v=v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055;return Math.round(Math.max(0,Math.min(1,v))*255);}
return[g(P),g(Q),g(S)];}
var rgb=o2r(l,c,h),hex='#'+rgb.map(function(v){return('0'+v.toString(16)).slice(-2)}).join('');
var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}m.setAttribute('content',hex);
var s=64,cv=document.createElement('canvas');cv.width=cv.height=s;var x=cv.getContext('2d');
function rr(x,X,Y,W,H,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+W,Y,X+W,Y+H,r);x.arcTo(X+W,Y+H,X,Y+H,r);x.arcTo(X,Y+H,X,Y,r);x.arcTo(X,Y,X+W,Y,r);x.closePath();}
x.translate(s/2,s/2);x.rotate(Math.PI/4);
var d=s*0.62,X=-d/2;x.fillStyle=hex;rr(x,X,X,d,d,s*0.13);x.fill();
var d2=d*0.42,X2=-d2/2;x.fillStyle='#fff';rr(x,X2,X2,d2,d2,s*0.07);x.fill();
var href=cv.toDataURL('image/png'),k=document.querySelector('link[rel="icon"]');
if(!k){k=document.createElement('link');k.setAttribute('rel','icon');document.head.appendChild(k);}
k.setAttribute('type','image/png');k.setAttribute('href',href);
}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BRAND_SCRIPT }} />
      </head>
      <body className={`${interTight.variable} antialiased`}>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
