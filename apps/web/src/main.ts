import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { bootstrapSession } from "./auth/session";
import "./styles.css";

bootstrapSession();

createApp(App).use(router).mount("#app");
