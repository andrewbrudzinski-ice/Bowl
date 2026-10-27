/* Store callbacks (store.read / transaction / preview) must be free of side effects outside `db`: PgStore re-runs a callback
 * each time it discovers another table it needs, so anything pushed into an outer variable is repeated. Return data instead.
 * Usage: npm run check:callbacks   (exits 1 on any finding) */
const ts=require("typescript"),path=require("path");
const root=path.resolve(__dirname,".."),cfg=ts.readConfigFile(root+"/tsconfig.json",ts.sys.readFile),parsed=ts.parseJsonConfigFileContent(cfg.config,ts.sys,root);
const program=ts.createProgram(parsed.fileNames,parsed.options),chk=program.getTypeChecker();
const MUT=new Set(["push","unshift","splice","set","add","delete","clear","pop","shift"]);
let found=0;
const log=console.log;console.log=(...a)=>{found++;log(...a);};
for(const sf of program.getSourceFiles()){ if(sf.isDeclarationFile||sf.fileName.includes("/scripts/")||sf.fileName.includes("node_modules")||sf.fileName.includes("/.next/"))continue;
 const visit=n=>{
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&/^(read|transaction|preview)$/.test(n.expression.name.text)&&n.arguments[0]&&ts.isFunctionLike(n.arguments[0])){
    const cb=n.arguments[0];
    const outer=id=>{const s=chk.getSymbolAtLocation(id);const d=s&&s.declarations&&s.declarations[0];return d&&!(d.pos>=cb.pos&&d.end<=cb.end)&&!ts.isParameter(d)&&!d.getSourceFile().isDeclarationFile;};
    const root_=e=>{while(e&&(ts.isPropertyAccessExpression(e)||ts.isElementAccessExpression(e)||ts.isNonNullExpression(e)))e=e.expression;return e;};
    const w=m=>{
      if(ts.isBinaryExpression(m)&&m.operatorToken.kind>=63&&m.operatorToken.kind<=78){const r=root_(m.left);if(r&&ts.isIdentifier(r)&&outer(r))console.log("ASSIGN",path.relative(root,sf.fileName)+":"+(sf.getLineAndCharacterOfPosition(m.getStart()).line+1),m.left.getText());}
      if(ts.isCallExpression(m)&&ts.isPropertyAccessExpression(m.expression)&&MUT.has(m.expression.name.text)){const r=root_(m.expression.expression);if(r&&ts.isIdentifier(r)&&outer(r)&&r.getText()!=="db")console.log("MUTCALL",path.relative(root,sf.fileName)+":"+(sf.getLineAndCharacterOfPosition(m.getStart()).line+1),m.getText().slice(0,70));}
      ts.forEachChild(m,w);};
    w(cb.body);
  }
  ts.forEachChild(n,visit);};
 visit(sf);}
console.log=log;
if(found){console.error(`${found} store callback(s) mutate outer state.`);process.exit(1);}
