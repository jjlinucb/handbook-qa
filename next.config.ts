import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native ONNX runtime for local embeddings; load from node_modules, don't bundle.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
