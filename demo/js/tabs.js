export function tabs() {
  document.querySelector('.bulma-tabs').addEventListener('click', (event) => {
    event.preventDefault();
    const target = event.target;
    // get element type
    if (target.nodeName != 'A') return;
    console.log(target, target.dataset.tab);

    document.querySelectorAll('.panel').forEach((panel) => {
      if (panel.dataset.panel == target.dataset.tab) {
        panel.classList.remove('is-hidden');
        document.querySelectorAll('.bulma-is-active').forEach((el) => {
          el.classList.remove('bulma-is-active');
        });
        target.parentElement.classList.add('bulma-is-active');
        return;
      }
      panel.classList.add('is-hidden');
    });
  });
}
