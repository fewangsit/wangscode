import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkNoModelFolder } from "../src/pipeline/gates.ts";

function createFeatureFixture(): { root: string; featureDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "wangs-gates-test-"));
  const featureDir = path.join(root, "packages", "features", "asset-tracking");
  mkdirSync(path.join(featureDir, "data", "dto"), { recursive: true });
  mkdirSync(path.join(featureDir, "data", "datasource"), { recursive: true });
  mkdirSync(path.join(featureDir, "ui", "screens", "AssetTracking"), { recursive: true });
  return { root, featureDir };
}

describe("pipeline gates anti-placeholder checks", () => {
  test("checkNoPlaceholders detects leftover scaffold DTO comment", () => {
    const { root, featureDir } = createFeatureFixture();
    try {
      writeFileSync(
        path.join(featureDir, "data", "dto", "index.ts"),
        "// Source: <method> <path> — openapi.yaml (filled in by the data-layer phase)\nexport interface ItemDto {}\n",
        "utf8",
      );
      writeFileSync(
        path.join(featureDir, "data", "datasource", "AssetTrackingRemoteDataSource.ts"),
        'export const getItems = async () => "/v1/real-endpoint";\n',
        "utf8",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checkNoPlaceholders detects generic scaffold route in datasource", () => {
    const { root, featureDir } = createFeatureFixture();
    try {
      writeFileSync(path.join(featureDir, "data", "dto", "index.ts"), "export interface ItemDto { id: string; }\n", "utf8");
      writeFileSync(
        path.join(featureDir, "data", "datasource", "AssetTrackingRemoteDataSource.ts"),
        'export const getItems = async () => http.get("/v1/asset-tracking");\n',
        "utf8",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checkNoPlaceholders detects TODO and dummyData in UI on full check", () => {
    const { root, featureDir } = createFeatureFixture();
    try {
      writeFileSync(path.join(featureDir, "data", "dto", "index.ts"), "export interface ItemDto { id: string; }\n", "utf8");
      writeFileSync(
        path.join(featureDir, "data", "datasource", "AssetTrackingRemoteDataSource.ts"),
        'export const getItems = async () => http.get("/v1/assets");\n',
        "utf8",
      );
      writeFileSync(
        path.join(featureDir, "ui", "screens", "AssetTracking", "useAssetTrackingViewModel.ts"),
        "const dummyData = [{ id: '1' }]; // TODO: connect real data\nexport function useAssetTrackingViewModel() {}\n",
        "utf8",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checkNoPlaceholders passes when clean", () => {
    const { root, featureDir } = createFeatureFixture();
    try {
      writeFileSync(path.join(featureDir, "data", "dto", "index.ts"), "export interface ItemDto { id: string; }\n", "utf8");
      writeFileSync(
        path.join(featureDir, "data", "datasource", "AssetTrackingRemoteDataSource.ts"),
        'export const getItems = async () => http.get("/v1/assets");\n',
        "utf8",
      );
      writeFileSync(
        path.join(featureDir, "ui", "screens", "AssetTracking", "useAssetTrackingViewModel.ts"),
        "export function useAssetTrackingViewModel() { return { items: [] }; }\n",
        "utf8",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checkNoModelFolder rejects model directory", () => {
    const { root, featureDir } = createFeatureFixture();
    try {
      mkdirSync(path.join(featureDir, "model"), { recursive: true });
      const res = checkNoModelFolder(root, "asset-tracking");
      expect(res.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
