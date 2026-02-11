import { NextResponse } from "next/server";

const GITHUB_REPO = "DevelopedByDev/overlay-releases";
const CACHE_DURATION = 600; // 10 minutes in seconds

export async function GET() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "overlay-landing",
        },
        next: { revalidate: CACHE_DURATION },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const release = await response.json();

    // Find the .dmg asset for Mac
    const dmgAsset = release.assets?.find(
      (asset: { name: string }) => asset.name.endsWith(".dmg")
    );

    if (!dmgAsset) {
      return NextResponse.json(
        { error: "No DMG file found in latest release" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      version: release.tag_name,
      downloadUrl: dmgAsset.browser_download_url,
      releaseName: release.name,
      publishedAt: release.published_at,
    });
  } catch (error) {
    console.error("Failed to fetch latest release:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest release" },
      { status: 500 }
    );
  }
}
