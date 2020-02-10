var express = require('express');
const shell = require('shelljs');
const dirTree = require("directory-tree");
var uniqid = require('uniqid');
const util = require('util')
var router = express.Router();
var pretty = require('express-prettify');

router.use(pretty({ query: 'pretty' }));

router.get('/clone/:repo/:branch', function (req, res) {

  const path = '/tmp'

  if (!shell.which('git')) {
    shell.echo('Sorry, this script requires git');
    shell.exit(1);
  }
  const id = uniqid();
  const url = "https://github.com/" + req.params.repo;
  shell.cd(path)
  shell.exec('git clone --single-branch --branch ' + req.params.branch + ' ' + url + ` ` + id, function (code, stdout, stderr) {
    console.log('Exit code:', code);
    console.log('Program output:', stdout);
    console.log('Program stderr:', stderr);

    const tree = dirTree(path + "/" + id, {
      exclude: /.git/,
      extensions: /\.(md|sol)$/
    });

    const workshops =
      tree.children // children are the directories with workshops
      //.filter(element => (typeof element.children != "undefined")) // exclude workshops without steps
      .map(element => ({
        name: element.name, // name of the workshop dir
        type: element.type,
        steps: ((typeof element.children != "undefined")? element.children: []) // steps subdirectories
          //.filter(element => (typeof element.children != "undefined"))
          .map(stepchild => ({
            name: stepchild.name,
            type: stepchild.type,
            markdown: ((typeof stepchild.children != "undefined")? stepchild.children: [])
              .filter(
                file => (file.extension == '.md')
              )
              .map(
                file => ({
                  name: file.name
                })
              ),
            sol: ((typeof stepchild.children != "undefined")? stepchild.children: [])
              .filter(
                file => (file.extension == '.sol')
              )
              .map(
                file => ({
                  name: file.name
                })
              ),

          }))
      }));

    console.log(util.inspect(workshops));
    res.json(workshops);
  });

})
module.exports = router;