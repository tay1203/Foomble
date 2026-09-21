const busboy = require("busboy");

// Bounded multipart reader for a single product's photos, preserving upload order.
function readLabelImages(req) {
  return new Promise((resolve, reject) => {
    const fail = (message) => reject(Object.assign(new Error(message), { status: 400 }));
    let parser;
    try {
      parser = busboy({ headers: req.headers, limits: { files: 4, fileSize: 8 * 1024 * 1024, fields: 0, parts: 5 } });
    } catch {
      fail("Upload label photos as multipart/form-data.");
      return;
    }
    const images = [];
    parser.on("file", (_name, file, info) => {
      const index = images.length;
      images.push(null);
      if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(info.mimeType)) {
        file.resume();
        fail("Use JPEG, PNG, WebP, HEIC, or HEIF label photos.");
        return;
      }
      const chunks = [];
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("limit", () => fail("Each photo must be under 8 MB."));
      file.on("error", () => fail("Unable to read the uploaded photo."));
      file.on("end", () => {
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) return fail("Empty photos are not supported.");
        images[index] = { inlineData: { data: buffer.toString("base64"), mimeType: info.mimeType } };
      });
    });
    parser.on("filesLimit", () => fail("Upload at most four photos of one product."));
    parser.on("fieldsLimit", () => fail("This endpoint accepts photos only."));
    parser.on("partsLimit", () => fail("Upload at most four photos of one product."));
    parser.on("error", () => fail("Invalid image upload."));
    parser.on("close", () => {
      if (!images.length || images.some((image) => !image)) return fail("Upload at least one complete label photo.");
      resolve(images);
    });
    parser.end(req.rawBody);
  });
}

module.exports = { readLabelImages };
