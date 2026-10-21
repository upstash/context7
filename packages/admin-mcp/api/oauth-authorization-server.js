import { authorizationServerMetadata, withCors } from "../dist/http.js";

export default {
  fetch: (request) => withCors(request, authorizationServerMetadata),
};
