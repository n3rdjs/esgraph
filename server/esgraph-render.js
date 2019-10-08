/* eslint-disable global-require */
/* eslint-disable no-console */
const esprima = require('esprima');
const walkes = require('walkes');

function esgraphRender(code, options) {
  if(require.cache[require.resolve('../../esgraph')]) {
    delete require.cache[require.resolve('../../esgraph')];
  }
  const esgraph = require('../../esgraph');
  console.log(1);
  console.log(code);
  let text = '';
  try {
    const fullAst = esprima.parse(code, { range: true });
    const functions = findFunctions(fullAst);

    text += 'digraph cfg {';
    text += 'node [shape="box"]';
    const dotOptions = { counter: 0, source: code };
    functions.concat(fullAst).forEach((ast, i) => {
      let cfg;
      let label = '[[main]]';
      if (ast.type.includes('Function')) {
        cfg = esgraph(ast.body);
        const name = (ast.id && ast.id.name) || '';
        const params = ast.params.map(p => p.name);
        label = `function ${name}(${params})`;
      } else {
        cfg = esgraph(ast);
      }

      text += `subgraph cluster_${i}{`;
      text += `label = "${label}"`;
      text += esgraph.dot(cfg, dotOptions);
      text += '}';
    });
    text += '}';
  } catch (e) {
    console.log(e);
    return { success: false, message: e.message };
  }
  return { success: true, dot: text };
}

function findFunctions(ast) {
  const functions = [];
  function handleFunction(node, recurse) {
    functions.push(node);
    recurse(node.body);
  }
  walkes(ast, {
    FunctionDeclaration: handleFunction,
    FunctionExpression: handleFunction,
  });
  return functions;
}
module.exports = esgraphRender;
