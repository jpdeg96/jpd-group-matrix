import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { validationError } from "@/lib/errors";
import { checkDriveAccess, DriveError, isDriveConfigured } from "@/lib/services/google-drive";
import { normaliseDriveFolderId } from "@/lib/services/settings";
import { driveTestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proves the whole chain: the key signs, Google accepts it, and the folder is
 * reachable.
 *
 * Takes the folder id from the request rather than from Settings so it can be
 * tested before being saved — which is the order anyone actually works in.
 * Nothing is uploaded, so this is safe to press repeatedly.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireAdmin();

    const input = driveTestSchema.parse(await readJson(request));

    if (!isDriveConfigured()) {
      throw validationError(
        "GOOGLE_SERVICE_ACCOUNT_JSON is not set on the server. Add it, restart, then try again.",
      );
    }

    const folderId = normaliseDriveFolderId(input.folderId);
    if (!folderId) throw validationError("Enter the folder ID first.");

    try {
      const { folderName, serviceAccountEmail } = await checkDriveAccess(folderId);
      return jsonOk({ folderName, serviceAccountEmail });
    } catch (error) {
      // DriveError messages are written for an administrator and name the
      // likely cause, so they are passed through rather than flattened into
      // "something went wrong".
      if (error instanceof DriveError) throw validationError(error.message);
      throw error;
    }
  });
}
