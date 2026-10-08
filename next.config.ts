import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    const movedCategories = [
      ["/products/nail-tools-care/prep-care", "/products/nail-care/prep-care"],
      ["/products/nail-accessories/nail-art", "/products/nail-art"],
      ["/products/nail-accessories", "/products/nail-art"],
    ] as const;
    return [
      ...movedCategories.flatMap(([source, destination]) => [
        { source, destination, permanent: true },
        { source: `/zh${source}`, destination: `/zh${destination}`, permanent: true },
        { source: `/en${source}`, destination, permanent: true },
      ]),
      { source: "/en", destination: "/", permanent: true },
      { source: "/en/:path*", destination: "/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
