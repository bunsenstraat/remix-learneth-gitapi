var express = require('express');
const shell = require('shelljs');
const dirTree = require("directory-tree");
var uniqid = require('uniqid');
const util = require('util')
var router = express.Router();

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
      tree.children
      .filter(element => (typeof element.children != "undefined"))
      .map(element => ({
        name: element.name,
        steps: element.children
          .filter(element => (typeof element.children != "undefined"))
          .map(stepchild => ({
            name: stepchild.name,
            markdown: stepchild.children
              .filter(
                file => (file.extension == '.md')
              )
              .map(
                file => ({
                  name: file.name
                })
              ),
            sol: stepchild.children
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
    res.send(workshops);
  });

})
module.exports = router;