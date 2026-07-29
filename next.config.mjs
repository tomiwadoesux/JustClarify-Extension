/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,

  // TEMPORARY: send the landing page straight to the demo. The landing code at
  // app/page.js is untouched — delete this redirects() block to restore it.
  //
  // `permanent: true` issues a 308 rather than a 307. A temporary redirect tells
  // Google not to pass ranking signals through to /demo and to keep `/` as the
  // indexed URL — which serves no content. Since /demo is the de-facto homepage
  // for now, the redirect has to be permanent for it to accumulate any authority.
  async redirects() {
    return [{ source: "/", destination: "/demo", permanent: true }];
  },
};

export default nextConfig;
