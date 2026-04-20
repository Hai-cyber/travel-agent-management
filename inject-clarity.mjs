// inject-clarity.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const CLARITY_SNIPPET = `  <!-- MS Clarity -->
  <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "weog9ymwey");
  </script>`;

function walk(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(walk(full));
    else if (extname(entry) === '.html') files.push(full);
  }
  return files;
}

const htmlFiles = walk('public');
let updated = 0, skipped = 0;

for (const file of htmlFiles) {
  const src = readFileSync(file, 'utf-8');
  if (src.includes('clarity.ms/tag/')) { skipped++; continue; }
  const injected = src.replace('</head>', CLARITY_SNIPPET + '\n</head>');
  if (injected !== src) {
    writeFileSync(file, injected, 'utf-8');
    updated++;
    console.log('  ✓', file.replace('public\\', ''));
  } else {
    console.log('  ! no </head> found:', file);
    skipped++;
  }
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped (already had it or no </head>).`);
