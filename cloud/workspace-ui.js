// Presentation only. API authorization remains on the server.
function workspaceOperator(user){return !!(user?.operations||user?.memberSchedules);}
function workspaceViewAllowed(view,user){
 if(view==='testing')return workspaceOperator(user);
 if(view==='members')return !!user?.memberSchedules;
 return true;
}
function bindWorkspace(user){
 document.body.dataset.session=user?'member':'guest';
 document.querySelectorAll('[data-operator-only]').forEach(node=>node.hidden=!workspaceOperator(user));
 if(!user||!workspaceViewAllowed(location.hash.slice(1),user))openView('events');
}
