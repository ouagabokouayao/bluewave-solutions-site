// Lit un corps de requête sans jamais dépasser la taille annoncée.
export async function readLimited(request, max) {
 const length = Number(request.headers.get('content-length') || 0);
 if (length > max) return {tooLarge:true};
 const reader = request.body?.getReader();
 if (!reader) return {invalid:true};
 const chunks=[]; let size=0;
 for (;;) {
  const {done,value}=await reader.read();
  if (done) break;
  size+=value.byteLength;
  if (size>max) {await reader.cancel();return {tooLarge:true};}
  chunks.push(value);
 }
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
 return {raw:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
}
