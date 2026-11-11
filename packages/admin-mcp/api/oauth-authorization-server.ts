import { authorizationServerMetadata, withCors } from "../src/http.js";

export default {
  fetch: (request: Request) => withCors(request, authorizationServerMetadata),
};
