if (location.protocol === 'file:') {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('file-help').hidden = false;
    document.getElementById('period').textContent = 'Откройте программу через файл запуска';
  });
}
