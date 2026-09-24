<script setup lang="ts">
defineProps<{ href: string; variant?: 'primary' | 'secondary' }>();
</script>

<template>
  <a :href="href" :class="['btn', `btn--${variant ?? 'primary'}`]"><slot /></a>
</template>
