/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,

  // TEMPORARY: send the landing page straight to the demo. The landing code at
  // app/page.js is untouched — delete this redirects() block to restore it.
  async redirects() {
    return [{ source: "/", destination: "/demo", permanent: false }];
  },
};

export default nextConfig;
