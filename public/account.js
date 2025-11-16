// Save inputs
document.querySelectorAll('input').forEach(input => {
  input.addEventListener('input', () => {
    localStorage.setItem(input.id, input.value);
  });
});

// Restore inputs
window.onload = () => {
  document.querySelectorAll('input').forEach(input => {
    if (localStorage.getItem(input.id)) {
      input.value = localStorage.getItem(input.id);
    }
  });
};
