import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

export default eveChannel({
  auth: [vercelOidc(), localDev(), placeholderAuth()],
});
