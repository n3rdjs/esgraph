function renderdot() {

    let code = document.getElementById('js-code-text').value;
    let data = {code: code};
    fetch('./dot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    }).then(function(response) {
        response.json().then((data) => {
            console.log(data);
            if(data.success) {
                let viz = new Viz();
                viz.renderSVGElement(data.dot)
                .then((element) => {
                    let area = document.getElementById("svg-draw");
                    area.innerHTML = ''
                    area.appendChild(element);
                })
                .catch((error) => {
                    viz = new Viz();
                    alert(error);
                })
            }
            else {
                alert(data.message);
            }
        });
    })
}