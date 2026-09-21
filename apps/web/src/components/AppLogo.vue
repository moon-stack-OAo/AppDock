<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number;
    word?: boolean;
    to?: string;
  }>(),
  {
    size: 28,
    word: true,
    to: "/",
  },
);
</script>

<template>
  <RouterLink :to="to" class="logo" aria-label="AppDock">
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="8"
        stroke="currentColor"
        stroke-opacity="0.2"
      />
      <path
        d="M9 8v16M9 10h8M9 16h11M9 22h6"
        stroke="var(--accent)"
        stroke-width="2.2"
        stroke-linecap="round"
      />
      <circle cx="23" cy="16" r="2.4" fill="var(--accent)" />
    </svg>
    <span v-if="word">App<span class="mark">Dock</span></span>
  </RouterLink>
</template>
