import('./app.js').catch((error) => {
  console.error(error);
  const message = document.querySelector('#tracking-status');
  message.textContent = 'Could not start. Check WebGL 2 and that MeeLive was built and served correctly.';
  message.classList.add('error');
});
