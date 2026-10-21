import { protectedResourceMetadata, withCors } from "../dist/http.js";

export default {
  fetch: (request) => withCors(request, () => Response.json(protectedResourceMetadata())),
};
