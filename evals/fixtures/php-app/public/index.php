<?php
function render(string $template, array $vars = []): string {
    extract($vars);
    ob_start();
    include __DIR__ . '/../templates/' . $template;
    return ob_get_clean();
}
$label = 'Sobre';
$href = '/about.php';
$content = '<main><h1>Acme</h1>' . render('partials/button.php', compact('label', 'href')) . '</main>';
echo render('layout.php', compact('content'));
