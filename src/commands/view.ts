import { Command } from 'commander';

export async function viewCommand(options: { 
  ease?: string; 
  speed?: string; 
  accuracy?: string; 
  comment?: string 
}): Promise<void> {
  const ease = parseInt(options.ease || '0', 10);
  const speed = parseInt(options.speed || '0', 10);
  const accuracy = parseInt(options.accuracy || '0', 10);

  const drawStars = (score: number) => {
    const stars = '★'.repeat(score);
    const empty = '☆'.repeat(5 - score);
    return `[ ${stars}${empty} ]`;
  };

  console.log('\n┌──────────────────────────────────────────┐');
  console.log('│          NUEVA VISTA DE CALIFICACIÓN     │');
  console.log('├──────────────────────────────────────────┤');
  console.log(`│ Facilidad de uso:   ${drawStars(ease)}     │`);
  console.log(`│ Velocidad:          ${drawStars(speed)}     │`);
  console.log(`│ Precisión:          ${drawStars(accuracy)}     │`);
  console.log('├──────────────────────────────────────────┤');
  if (options.comment) {
    console.log(`│ Comentario:                              │`);
    // Basic wrapping for the comment
    const comment = options.comment.substring(0, 38);
    console.log(`│ ${comment.padEnd(40)} │`);
  }
  console.log('├──────────────────────────────────────────┤');
  console.log('│ ¡Gracias por calificar tu experiencia!   │');
  console.log('└──────────────────────────────────────────┘\n');
}
