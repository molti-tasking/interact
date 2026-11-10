import { requireDesigner, UnauthorizedError } from "@/lib/auth";
import { BRIEF_DEFINITIONS } from "@/lib/study/briefs.server";
import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";

/**
 * GET /api/study/brief/<key> — the brief's situation as a PNG.
 *
 * An image on purpose: participants have to put the situation into their
 * own words instead of pasting it into the tool. The text is rendered here
 * and never sent to a participant's browser as text.
 */
export const runtime = "nodejs";

const WIDTH = 1400;
const PADDING = 72;
const FONT = 33;
const LINE = 1.5;
const TITLE = 46;
const GAP = 30;
/** Average character width of the default font, as a share of the font size */
const CHAR = 0.52;

function linesOf(text: string): number {
  const perLine = Math.floor((WIDTH - 2 * PADDING) / (FONT * CHAR));
  return Math.ceil(text.length / perLine);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    await requireDesigner();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
  const { key } = await params;
  const brief = BRIEF_DEFINITIONS[key];
  if (!brief) return NextResponse.json({ error: "Unknown brief" }, { status: 404 });

  // Estimated, with room to spare: text that ran over would be cut off
  const textLines = brief.story.reduce((n, p) => n + linesOf(p) + 0.5, 0);
  const height = Math.round(
    2 * PADDING + TITLE * 1.6 + textLines * FONT * LINE + brief.story.length * GAP,
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#fffdf8",
          color: "#1f2328",
          padding: PADDING,
        }}
      >
        <div style={{ display: "flex", fontSize: TITLE, fontWeight: 700, marginBottom: GAP }}>
          {brief.title}
        </div>
        {brief.story.map((paragraph, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              fontSize: FONT,
              lineHeight: LINE,
              marginBottom: GAP,
            }}
          >
            {paragraph}
          </div>
        ))}
      </div>
    ),
    {
      width: WIDTH,
      height,
      headers: { "Cache-Control": "private, max-age=3600" },
    },
  );
}
