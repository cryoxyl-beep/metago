/**
 * Uploads a base64 encoded image to Cloudinary using an unsigned upload preset.
 * Fallbacks are implemented to gracefully log and handle any API network failures.
 */
export async function uploadImageToCloudinary(base64Data: string): Promise<string> {
  const cloudName = (import.meta as any).env.VITE_CLOUDINARY_CLOUD_NAME || "dirposh00";
  const uploadPreset = (import.meta as any).env.VITE_CLOUDINARY_UPLOAD_PRESET || "Questions";

  if (!base64Data) {
    throw new Error("Empty image data provided to Cloudinary upload");
  }

  // Ensure base64 string is wrapped as a data URL for Cloudinary's support
  let filePayload = base64Data;
  if (!filePayload.startsWith("data:")) {
    filePayload = `data:image/png;base64,${filePayload}`;
  }

  console.log(`[Cloudinary Upload Start] Cloud: ${cloudName}, Preset: ${uploadPreset}, Data length: ${filePayload.length}`);

  const formData = new FormData();
  formData.append("file", filePayload);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Cloudinary API Error]", response.status, errorText);
    throw new Error(`Cloudinary API responded with status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (!data.secure_url) {
    console.error("[Cloudinary Response Malformed]", data);
    throw new Error("Cloudinary response did not contain secure_url");
  }

  console.log(`[Cloudinary Upload Success] Image permanently saved at: ${data.secure_url}`);
  return data.secure_url;
}

/**
 * Helper to filter out decorative images (logos, separators, watermarks, tiny icons),
 * only allowing scientific question visuals above a width/height threshold.
 */
export async function shouldUploadImage(base64Data: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const minDimension = 64; // Filter out tiny icons, logos, separator lines (< 64px)
      const isLargeEnough = img.width >= minDimension && img.height >= minDimension;
      console.log(`[Image Filter check] Image dimensions: ${img.width}x${img.height}px. Pass: ${isLargeEnough}`);
      resolve(isLargeEnough);
    };
    img.onerror = () => {
      console.error("[Image Filter error] Failed to load image dimensions");
      resolve(false); // err on the side of caution
    };
    img.src = base64Data.startsWith("data:") ? base64Data : `data:image/png;base64,${base64Data}`;
  });
}

